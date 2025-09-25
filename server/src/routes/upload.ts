import express from "express";
import crypto from "crypto";
import { db } from "../services/db.js";
import { ingestFile } from "../pipeline/ingest.js";

const router = express.Router();

// Resolve accountId from x-user-id header
async function resolveAccountId(req: express.Request): Promise<string> {
  const uid = (req.header("x-user-id") || "").trim();
  if (!uid) throw Object.assign(new Error("x-user-id required"), { status: 400 });
  
  // For demo mode, return a mock account ID
  // In a real implementation, this would query the database
  return "demo-account-123";
}

// JSON upload endpoint (simple demo: text or base64 bytes)
// Body: { title, text?, bytes_base64?, path? }
router.post("/ingest/upload", async (req, res) => {
  try {
    const accountId = await resolveAccountId(req);
    const { title, text, bytes_base64, path } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    if (!text && !bytes_base64) return res.status(400).json({ error: "text or bytes_base64 required" });
    
    // For demo mode, simulate file processing without actual database operations
    const docId = crypto.randomUUID();
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    res.json({ 
      ok: true, 
      docId: docId,
      message: "File uploaded successfully (demo mode)",
      added: 1
    });
  } catch (e: any) {
    const status = e?.status || 500;
    res.status(status).json({ error: e?.message || "upload error" });
  }
});

export default router;


