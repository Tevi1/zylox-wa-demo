import express from "express";
import { db } from "../services/db.js";

const router = express.Router();

// Clears WhatsApp ingests for the current user (resolved via x-user-id)
router.post("/admin/reset/whatsapp", async (req, res) => {
  try {
    const uid = (req.header("x-user-id") || "").trim();
    if (!uid) return res.status(400).json({ error: "x-user-id required" });
    const ua = await db.oneOrNone("SELECT account_id FROM user_accounts WHERE uid=$1", [uid]);
    if (!ua) return res.status(404).json({ error: "user not initialized" });
    const accountId = ua.account_id as string;

    const result = await db.tx(async (t) => {
      const docs = await t.manyOrNone(
        "SELECT doc_id FROM documents WHERE account_id=$1 AND source='whatsapp'",
        [accountId]
      );
      if (docs.length === 0) return { docs: 0, chunks: 0, embeddings: 0, documents: 0, audit: 0 };
      const docIds = docs.map((d: any) => d.doc_id);

      // delete embeddings -> chunks -> documents
      const embRes = await t.result(
        `DELETE FROM embeddings e USING chunks c
          WHERE c.chunk_id=e.chunk_id AND c.doc_id = ANY($1)`,
        [docIds]
      );
      const chkRes = await t.result(
        `DELETE FROM chunks WHERE doc_id = ANY($1)`,
        [docIds]
      );
      const docRes = await t.result(
        `DELETE FROM documents WHERE doc_id = ANY($1)`,
        [docIds]
      );
      // optional: clear whatsapp audit entries
      const audRes = await t.result(
        `DELETE FROM audit WHERE account_id=$1 AND (subject='whatsapp' OR subject LIKE 'doc:%')`,
        [accountId]
      );
      return { docs: docIds.length, chunks: chkRes.rowCount, embeddings: embRes.rowCount, documents: docRes.rowCount, audit: audRes.rowCount };
    });

    res.json({ ok: true, accountId, cleared: result });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message || "reset error" });
  }
});

export default router;


