import express from "express";
import OpenAI from "openai";
import { db } from "../services/db.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const router = express.Router();

// Agent prompts
const PROMPT_LEGAL = `
You are a Legal Agent. Analyze the question using ONLY the provided context.

If insufficient context, return: {"agent": "Legal", "insufficient_context": true, "bullets": ["Insufficient context for legal analysis"], "evidence": [], "risk_level": "high"}

Otherwise, return valid JSON with this exact structure:
{
  "agent": "Legal",
  "insufficient_context": false,
  "bullets": ["Your analysis here with [n] citations"],
  "evidence": [{"n": 1, "title": "Doc title", "page": 1, "snippet": "..."}],
  "risk_level": "low|medium|high"
}

Question: {{question}}
Context: {{context}}
`;

const PROMPT_FINANCE = `
You are a Finance Agent. Analyze the question using ONLY the provided context.

If insufficient context, return: {"agent": "Finance", "insufficient_context": true, "bullets": ["Insufficient context for financial analysis"], "evidence": [], "risk_level": "high"}

Otherwise, return valid JSON with this exact structure:
{
  "agent": "Finance",
  "insufficient_context": false,
  "bullets": ["Your analysis here with [n] citations"],
  "evidence": [{"n": 1, "title": "Doc title", "page": 1, "snippet": "..."}],
  "risk_level": "low|medium|high"
}

Question: {{question}}
Context: {{context}}
`;

const PROMPT_OPS = `
You are an Operations Agent. Analyze the question using ONLY the provided context.

If insufficient context, return: {"agent": "Ops", "insufficient_context": true, "bullets": ["Insufficient context for operations analysis"], "evidence": [], "risk_level": "high"}

Otherwise, return valid JSON with this exact structure:
{
  "agent": "Ops",
  "insufficient_context": false,
  "bullets": ["Your analysis here with [n] citations"],
  "evidence": [{"n": 1, "title": "Doc title", "page": 1, "snippet": "..."}],
  "risk_level": "low|medium|high"
}

Question: {{question}}
Context: {{context}}
`;

const PROMPT_ANALYST = `
You are an Analyst Agent. Analyze the question using ONLY the provided context.

If insufficient context, return: {"agent": "Analyst", "insufficient_context": true, "bullets": ["Insufficient context for analysis"], "evidence": [], "risk_level": "high"}

Otherwise, return valid JSON with this exact structure:
{
  "agent": "Analyst",
  "insufficient_context": false,
  "bullets": ["Your analysis here with [n] citations"],
  "evidence": [{"n": 1, "title": "Doc title", "page": 1, "snippet": "..."}],
  "risk_level": "low|medium|high"
}

Question: {{question}}
Context: {{context}}
`;

const PROMPT_TAX = `
You are a Tax Agent. Analyze the question using ONLY the provided context.

If insufficient context, return: {"agent": "Tax", "insufficient_context": true, "bullets": ["Insufficient context for tax analysis"], "evidence": [], "risk_level": "high"}

Otherwise, return valid JSON with this exact structure:
{
  "agent": "Tax",
  "insufficient_context": false,
  "bullets": ["Your analysis here with [n] citations"],
  "evidence": [{"n": 1, "title": "Doc title", "page": 1, "snippet": "..."}],
  "risk_level": "low|medium|high"
}

Question: {{question}}
Context: {{context}}
`;

const PROMPT_STRATEGY = `
You are a Strategy Agent. Analyze the question using ONLY the provided context.

If insufficient context, return: {"agent": "Strategy", "insufficient_context": true, "bullets": ["Insufficient context for strategy analysis"], "evidence": [], "risk_level": "high"}

Otherwise, return valid JSON with this exact structure:
{
  "agent": "Strategy",
  "insufficient_context": false,
  "bullets": ["Your analysis here with [n] citations"],
  "evidence": [{"n": 1, "title": "Doc title", "page": 1, "snippet": "..."}],
  "risk_level": "low|medium|high"
}

Question: {{question}}
Context: {{context}}
`;

const PROMPT_MASTER_BRAIN = `
You are **Master Brain**, orchestrating specialist agents (Legal, Finance, Ops, Analyst, Tax, Strategy).
You have their JSON outputs. Your job is to weigh them, resolve conflicts, and produce a concise, executive-ready answer.

Rules:
- Use ONLY the provided AGENT_JSON, CONTEXT, and MEMORIES.
- Prefer the most recent and most corroborated sources if agents conflict.
- Do NOT include citation references like [1], [2], etc.
- Do NOT include Agent Verdicts section or details/summary tags.
- Be crisp. No fluff.

OUTPUT FORMAT (plain text markdown):
Executive Summary (2–3 bullets)
Key Insights (2–4 bullets)
Risks / Unknowns (1–3 bullets)
Recommended Actions (numbered; include owners/dates if present)
Confidence: High / Medium / Low (based on agent agreement + source count)

INPUTS
QUESTION:
{{question}}

MEMORIES:
{{memories}}

CONTEXT (retrieved chunks):
{{context}}

AGENT_JSON (array of agent results as valid JSON objects):
{{agent_json}}
`;

interface AgentResponse {
  agent: "Legal" | "Finance" | "Ops" | "Analyst" | "Tax" | "Strategy";
  insufficient_context: boolean;
  bullets: string[];
  evidence: Array<{
    n: number;
    title: string;
    page: number | null;
    snippet: string;
  }>;
  risk_level: "low" | "medium" | "high";
}

const AGENT_CONFIGS = [
  { name: "Legal", prompt: PROMPT_LEGAL },
  { name: "Finance", prompt: PROMPT_FINANCE },
  { name: "Ops", prompt: PROMPT_OPS },
  { name: "Analyst", prompt: PROMPT_ANALYST },
  { name: "Tax", prompt: PROMPT_TAX },
  { name: "Strategy", prompt: PROMPT_STRATEGY }
];

router.post("/chat-agents", async (req, res) => {
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

  // Get embeddings for question
  const emb = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: question
  });
  const qvec = emb.data[0].embedding;

  // Retrieve relevant chunks
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

  // Smart filtering logic (same as original)
  const qlc = String(question || '').toLowerCase();
  const nowMs = Date.now();
  let filtered: any[] = rows.slice();
  const wantsLatest = qlc.includes('latest') || qlc.includes('recent') || qlc.includes('today');
  const mentionsWhatsApp = qlc.includes('whatsapp') || qlc.includes('wa ');
  const mentionsPdfDeck = qlc.includes('pdf') || qlc.includes('deck') || qlc.includes('pitch') || qlc.includes('slides') || qlc.includes('presentation');

  if (mentionsWhatsApp) {
    const waOnly = filtered.filter(r => r.source === 'whatsapp');
    if (waOnly.length) filtered = waOnly;
  }
  if (mentionsPdfDeck) {
    const deckTitleMatch = (t: string) => t.includes('pdf') || t.includes('deck') || t.includes('pitch') || t.includes('slides') || t.includes('presentation');
    const byTitle = filtered.filter(r => deckTitleMatch(String(r.title || '').toLowerCase()));
    if (byTitle.length) filtered = byTitle;
  }

  if (wantsLatest) {
    const windowHours = 36;
    const winMs = windowHours * 3600 * 1000;
    const byWindow = filtered.filter(r => (nowMs - new Date(r.created_at).getTime()) <= winMs);
    if (byWindow.length) {
      filtered = byWindow;
    } else {
      filtered = filtered.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, topK * 2);
    }
  }

  // Apply recency boost
  const boosted = filtered.map(r => {
    const ageH = Math.max(0, (nowMs - new Date(r.created_at).getTime()) / 3600000);
    const recencyBoost = Math.exp(-ageH / 24);
    const recencyWeight = (wantsLatest || mentionsWhatsApp || mentionsPdfDeck) ? 0.6 : 0.25;
    const adj = Number(r.score) + recencyWeight * recencyBoost;
    return { ...r, _adj: adj };
  }).sort((a: any, b: any) => b._adj - a._adj);

  // Select top chunks
  const selected = mmrLite(boosted, Math.min(topK, 6));
  const cites = selected.map((r: any, i: number) => ({
    idx: i + 1, docId: r.doc_id, title: r.title, page: r.page || 1,
    snippet: r.text.slice(0, 220), confidence: Number(r.score?.toFixed(3) || 0)
  }));

  // Build context
  const context = selected.map((r: any, i: number) => {
    const d = new Date(r.created_at).toISOString().slice(0, 10);
    return `[${i + 1}] ${r.title} (${d}; p.${r.page || 1})\n${r.text}`;
  }).join("\n\n");

  // Get Miyagi memories (placeholder for now)
  const memories = "";

  try {
    // Step 1: Call all agents in parallel
    const agentPromises = AGENT_CONFIGS.map(async (config) => {
      try {
        const prompt = config.prompt
          .replace('{{question}}', question)
          .replace('{{memories}}', memories)
          .replace('{{context}}', context);

        const completion = await client.chat.completions.create({
          model: process.env.LLM_MODEL || "gpt-4o",
          messages: [
            {
              role: "system",
              content: "You are a specialized AI agent. Return ONLY valid JSON matching the specified schema. Do not include markdown code blocks, backticks, or any other formatting. Return pure JSON only."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.1
        });

        let response = completion.choices[0]?.message?.content || "";
        
        // Clean up response to extract JSON
        response = response.trim();
        if (response.startsWith('```json')) {
          response = response.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (response.startsWith('```')) {
          response = response.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        
        console.log(`Raw response from ${config.name}:`, response);
        
        const agentResponse = JSON.parse(response) as AgentResponse;
        
        // Validate response
        if (!agentResponse.agent || !Array.isArray(agentResponse.bullets) || 
            typeof agentResponse.insufficient_context !== 'boolean' || 
            !agentResponse.risk_level) {
          console.error(`Invalid response format from ${config.name}:`, agentResponse);
          throw new Error('Invalid agent response format');
        }

        return agentResponse;
      } catch (error) {
        console.error(`Error calling ${config.name} agent:`, error);
        return {
          agent: config.name as AgentResponse['agent'],
          insufficient_context: true,
          bullets: [`⚠️ ${config.name} agent unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`],
          evidence: [],
          risk_level: 'high' as const
        };
      }
    });

    const agentResponses = await Promise.all(agentPromises);

    // Step 2: Filter out agents with insufficient context
    const validAgents = agentResponses.filter(agent => !agent.insufficient_context);
    
    // Step 3: Call Master Brain
    let masterBrainAnswer = '';
    let confidence: 'high' | 'medium' | 'low' = 'low';

    if (validAgents.length > 0) {
      const agentJson = JSON.stringify(validAgents, null, 2);
      const masterPrompt = PROMPT_MASTER_BRAIN
        .replace('{{question}}', question)
        .replace('{{memories}}', memories)
        .replace('{{context}}', context)
        .replace('{{agent_json}}', agentJson);

      const masterCompletion = await client.chat.completions.create({
        model: process.env.LLM_MODEL_THINKING || "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are Master Brain. Return a structured markdown response with the specified format."
          },
          {
            role: "user",
            content: masterPrompt
          }
        ],
        temperature: 0.1
      });

      masterBrainAnswer = masterCompletion.choices[0]?.message?.content || "";
      
      // Determine confidence
      const totalAgents = agentResponses.length;
      const validAgentCount = validAgents.length;
      const highRiskCount = agentResponses.filter(a => a.risk_level === 'high').length;
      
      if (validAgentCount >= 4 && highRiskCount <= 1) {
        confidence = 'high';
      } else if (validAgentCount >= 2 && highRiskCount <= 2) {
        confidence = 'medium';
      } else {
        confidence = 'low';
      }
    } else {
      masterBrainAnswer = "⚠️ Insufficient context from all agents. Please provide more specific information or check your data sources.";
      confidence = 'low';
    }

    // Log to audit
    await db.none(`INSERT INTO audit(account_id, who, action, subject, details)
                   VALUES($1,$2,'chat',$3,$4)`,
                  [accountId, "user", "qna", { question, cites, agentResponses }]);

    res.json({ 
      answer: masterBrainAnswer, 
      citations: cites,
      agentResponses: agentResponses,
      confidence: confidence
    });
  } catch (error) {
    console.error('Error in agent orchestration:', error);
    res.status(500).json({ 
      answer: "⚠️ Agent orchestration failed. Please try again.",
      citations: [],
      agentResponses: [],
      confidence: 'low'
    });
  }
});

function mmrLite(rows: any[], k: number) {
  const sel: any[] = [];
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
