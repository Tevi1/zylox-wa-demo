import express from "express";
import OpenAI from "openai";
import { db } from "../services/db.js";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const router = express.Router();

router.post("/chat", async (req, res) => {
  let { accountId, question, topK = 10 } = req.body;

  // resolve accountId from x-user-id if not provided
  if (!accountId) {
    const uid = (req.header("x-user-id") || "").trim();
    if (!uid) return res.status(400).json({ error: "x-user-id or accountId required" });
    const row = await db.oneOrNone(
      "SELECT account_id FROM user_accounts WHERE uid=$1",
      [uid]
    );
    if (!row) return res.status(404).json({ error: "user not initialized" });
    accountId = row.account_id;
  }

  const emb = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: question
  });
  const qvec = emb.data[0].embedding;

  const rows = await db.manyOrNone(
    `SELECT c.chunk_id, c.doc_id, d.title, c.page, c.text,
            1 - (e.vector <=> $1::vector) AS score,
            d.created_at, d.source
       FROM embeddings e
       JOIN chunks c ON c.chunk_id = e.chunk_id
       JOIN documents d ON d.doc_id = c.doc_id
      WHERE e.account_id = $2
      ORDER BY e.vector <=> $1::vector
      LIMIT $3`,
    [qvec, accountId, topK * 3]
  );

  // bias towards recency, optionally filter by "latest" terms and WhatsApp
  const qlc = String(question || '').toLowerCase();
  const nowMs = Date.now();
  let filtered:any[] = rows.slice();
  const wantsLatest = qlc.includes('latest') || qlc.includes('recent') || qlc.includes('today');
  const mentionsWhatsApp = qlc.includes('whatsapp') || qlc.includes('wa ');
  const mentionsPdfDeck = qlc.includes('pdf') || qlc.includes('deck') || qlc.includes('pitch') || qlc.includes('slides') || qlc.includes('presentation');

  // If the question mentions WhatsApp, prefer WhatsApp-only context if available
  if (mentionsWhatsApp) {
    const waOnly = filtered.filter(r => r.source === 'whatsapp');
    if (waOnly.length) filtered = waOnly;
  }
  if (mentionsPdfDeck) {
    const deckTitleMatch = (t:string)=> t.includes('pdf') || t.includes('deck') || t.includes('pitch') || t.includes('slides') || t.includes('presentation');
    const byTitle = filtered.filter(r => deckTitleMatch(String(r.title||'').toLowerCase()));
    if (byTitle.length) filtered = byTitle;
  }

  // If the question asks for latest/recent, focus on a tighter time window
  if (wantsLatest) {
    const windowHours = 36; // last 1.5 days
    const winMs = windowHours * 3600 * 1000;
    const byWindow = filtered.filter(r => (nowMs - new Date(r.created_at).getTime()) <= winMs);
    if (byWindow.length) {
      filtered = byWindow;
    } else {
      // fallback: take the most recent few items from the preferred set
      filtered = filtered.sort((a:any,b:any)=> new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, topK * 2);
    }
  }

  // Stronger recency focus: when WhatsApp is mentioned, constrain to recent WA docs (24–48h) or latest few docs
  if (mentionsWhatsApp) {
    const windowHoursWA = wantsLatest ? 24 : 48;
    const winMsWA = windowHoursWA * 3600 * 1000;
    const waRecent = filtered.filter(r => (nowMs - new Date(r.created_at).getTime()) <= winMsWA);
    if (waRecent.length) {
      filtered = waRecent;
    } else {
      // choose top N latest WA documents and keep only their chunks
      const topDocsCount = Math.max(1, Math.min(3, topK));
      const docToTime: Record<string, number> = {} as any;
      for (const r of filtered) {
        const t = new Date(r.created_at).getTime();
        if (!docToTime[r.doc_id] || t > docToTime[r.doc_id]) docToTime[r.doc_id] = t;
      }
      const latestDocIds = Object.entries(docToTime)
        .sort((a,b)=> b[1]-a[1])
        .slice(0, topDocsCount)
        .map(([id])=> id);
      const keep = new Set(latestDocIds);
      filtered = filtered.filter(r => keep.has(r.doc_id));
    }
  }
  // Similar tightening for PDFs/decks: restrict to most recent deck docs
  if (mentionsPdfDeck) {
    const windowHoursDeck = wantsLatest ? 48 : 96;
    const winMsDeck = windowHoursDeck * 3600 * 1000;
    const deckRecent = filtered.filter(r => (nowMs - new Date(r.created_at).getTime()) <= winMsDeck);
    if (deckRecent.length) {
      filtered = deckRecent;
    }
    // keep only newest 1–2 deck docs
    const topDocsCount = Math.max(1, Math.min(2, topK));
    const docToTime: Record<string, number> = {} as any;
    for (const r of filtered) {
      const t = new Date(r.created_at).getTime();
      if (!docToTime[r.doc_id] || t > docToTime[r.doc_id]) docToTime[r.doc_id] = t;
    }
    const latestDocIds = Object.entries(docToTime)
      .sort((a,b)=> b[1]-a[1])
      .slice(0, topDocsCount)
      .map(([id])=> id);
    const keep = new Set(latestDocIds);
    filtered = filtered.filter(r => keep.has(r.doc_id));
  }

  // Hard gate: if user asks for latest or mentions WhatsApp/PDF, restrict to the newest single document only
  if (wantsLatest || mentionsWhatsApp || mentionsPdfDeck) {
    if (filtered.length) {
      const newestDocId = filtered.reduce((acc:string|null, r:any) => {
        if (!acc) return r.doc_id;
        const a = filtered.find(x => x.doc_id === acc)!;
        return new Date(r.created_at).getTime() > new Date(a.created_at).getTime() ? r.doc_id : acc;
      }, null as any);
      if (newestDocId) {
        filtered = filtered.filter(r => r.doc_id === newestDocId);
      }
    }
  }
  // recency boost on top of similarity
  const boosted = filtered.map(r => {
    const ageH = Math.max(0, (nowMs - new Date(r.created_at).getTime()) / 3600000);
    const recencyBoost = Math.exp(-ageH / 24); // decays by day
    // increase weight on recency when asking for latest or when focusing WhatsApp
    const recencyWeight = (wantsLatest || mentionsWhatsApp || mentionsPdfDeck) ? 0.6 : 0.25;
    const adj = Number(r.score) + recencyWeight * recencyBoost;
    return { ...r, _adj: adj };
  }).sort((a:any,b:any)=> b._adj - a._adj);
  const selected = mmrLite(boosted, Math.min(topK, 6));
  const cites = selected.map((r:any, i:number) => ({
    idx: i+1, docId: r.doc_id, title: r.title, page: r.page || 1,
    snippet: r.text.slice(0, 220), confidence: Number(r.score?.toFixed(3) || 0)
  }));

  const hasWhatsApp = selected.some((r:any)=> r.source === 'whatsapp');
  const context = selected.map((r:any,i:number)=>{
    const d = new Date(r.created_at).toISOString().slice(0,10);
    return `[${i+1}] ${r.title} (${d}; p.${r.page||1})\n${r.text}`;
  }).join("\n\n");

  // Standard Q&A (fast) - gpt-4o
  const qaCompletion = await client.chat.completions.create({
    model: process.env.LLM_MODEL || "gpt-4o",
    messages: [
      {
        role: "system",
        content: [
          "You are a senior consultant. Be crisp, decision-oriented, and specific.",
          "Answer using ONLY the numbered context blocks [1..N]. If info is missing, say so under 'Insufficient context' and do not invent details.",
          "If the user asks for the 'latest WhatsApp update' or similar, interpret it as: summarise the most recent WhatsApp messages in the provided context for this account (those whose source is WhatsApp). Do not treat it as app release notes.",
          "If at least one WhatsApp context block is present, produce a concise summary using only those blocks; then list any missing specifics under 'Insufficient context'.",
          "Rules:",
          "• Every factual claim MUST cite one or more blocks inline like [1], [2].",
          "• Use the exact bracket numbers of the context blocks.",
          "• Prefer the most recent items when sources conflict; include dates inline when helpful.",
          "• No throat-clearing or filler. No long quotes; summarize.",
          "",
          "Format (hard limits):",
          "EXECUTIVE SUMMARY — 2–3 bullets, max 18 words each, each ends with cites.",
          "KEY INSIGHTS — 3–6 bullets, each ends with cites.",
          "RISKS / UNKNOWNS — 2–5 bullets (include what's missing), each ends with cites if applicable.",
          "RECOMMENDED ACTIONS — numbered; include owners/dates if present; each ends with cites.",
          "FOLLOW-UPS — 2–3 short questions.",
          "CITATIONS — list [n] → Title (date; page/line if provided).",
          "END WITH — Confidence: High/Medium/Low based on source agreement, recency, and number of cites."
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `Question: ${question}`,
          "",
          `WhatsApp messages present in context: ${hasWhatsApp ? 'yes' : 'no'} — prefer them if the question mentions WhatsApp or 'latest update'.`,
          "",
          "Context blocks (use these ONLY):",
          context
        ].join("\n")
      }
    ]
  });

  const qaAnswer = (qaCompletion.choices[0]?.message?.content || "").trim();

  // Master Brain synthesis (gpt-5-thinking) - only if we have context
  let masterBrainAnswer = qaAnswer;
  if (!qaAnswer.includes('Insufficient context') && selected.length > 0) {
    const masterBrainCompletion = await client.chat.completions.create({
      model: process.env.LLM_MODEL_THINKING || "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are the Master Brain orchestrating a team of specialist agents (Legal, Finance, Ops, Analyst, Tax).
Your job is to combine their verdicts into a single high-signal answer.

Rules:
- Use ONLY the provided context (retrieved docs, transcripts, or memory). If info is missing, say "Insufficient context."
- Every factual bullet MUST end with a citation [n].
- Be concise and structured. Never ramble.

Output format:
Executive Summary (2–3 bullets, plain English for execs)
Key Insights (bullets, factual, each ends with [n])
Risks / Unknowns (bullets, each ends with [n] if possible)
Recommended Actions (numbered list, owners/dates if available)
Confidence: High / Medium / Low (based on agreement + source count)

Agent Verdicts (collapsible section at end):
- Legal: 1–2 bullets (contracts, compliance) [n]
- Finance: 1–2 bullets (funding, KPIs, costs) [n]
- Ops: 1–2 bullets (WhatsApp, daily execution) [n]
- Analyst: 1–2 bullets (data, risks, synthesis) [n]
- Tax: 1–2 bullets (tax/legal edge cases) [n]

Final note:
Prefer the most recent info if sources conflict. Keep total output ≤7 bullets per section.`
        },
        {
          role: "user",
          content: `Question: ${question}\n\nContext:\n${context}`
        }
      ]
    });

    masterBrainAnswer = (masterBrainCompletion.choices[0]?.message?.content || "").trim();
  }

  const answer = masterBrainAnswer;
  await db.none(`INSERT INTO audit(account_id, who, action, subject, details)
                 VALUES($1,$2,'chat',$3,$4)`,
                [accountId, "user", "qna", { question, cites }]);
  res.json({ answer, citations: cites });
});

function mmrLite(rows:any[], k:number){
  const sel:any[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.doc_id;
    if (!seen.has(key)) {
      sel.push(r); seen.add(key);
    }
    if (sel.length >= k) break;
  }
  return sel;
}
export default router;


