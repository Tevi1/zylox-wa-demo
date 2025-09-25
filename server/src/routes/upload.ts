import express from "express";
import { db } from "../services/db.js";
import { ingestFile } from "../pipeline/ingest.js";

const router = express.Router();

// Resolve accountId from x-user-id header
async function resolveAccountId(req: express.Request): Promise<string> {
  const uid = (req.header("x-user-id") || "").trim();
  if (!uid) throw Object.assign(new Error("x-user-id required"), { status: 400 });
  const row = await db.oneOrNone("SELECT account_id FROM user_accounts WHERE uid=$1", [uid]);
  if (!row) throw Object.assign(new Error("user not initialized"), { status: 404 });
  return row.account_id as string;
}

// JSON upload endpoint (simple demo: text or base64 bytes)
// Body: { title, text?, bytes_base64?, path? }
router.post("/ingest/upload", async (req, res) => {
  try {
    const accountId = await resolveAccountId(req);
    const { title, text, bytes_base64, path } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    if (!text && !bytes_base64) return res.status(400).json({ error: "text or bytes_base64 required" });
    const bytes: Buffer = text ? Buffer.from(text, "utf8") : Buffer.from(String(bytes_base64), "base64");
    const out = await ingestFile({ accountId, bytes, title, source: "upload", path: path || null as any });
    res.json({ ok: true, docId: out.docId });
  } catch (e: any) {
    const status = e?.status || 500;
    res.status(status).json({ error: e?.message || "upload error" });
  }
});

export default router;


