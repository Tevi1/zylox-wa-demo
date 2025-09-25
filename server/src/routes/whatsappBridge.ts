import express from "express";
import { db } from "../services/db.js";
import { ingestFile } from "../pipeline/ingest.js";

const router = express.Router();
const CODE = /^([A-Z]{2}-[A-Z0-9]{6})$/;

router.post("/ingest/whatsapp-bridge", async (req, res) => {
  const { from, routing_code, text, media } = req.body || {};
  try {
    // ignore group messages for demo
    if (typeof from === "string" && from.endsWith("@g.us")) {
      return res.json({ ok: true, ignored: true, reason: "group" });
    }
    // try bind-or-rebind using routing_code first
    let row = await db.oneOrNone("SELECT account_id FROM wa_bindings WHERE wa_number=$1", [from]);
    if (routing_code && CODE.test(routing_code)) {
      const bind = await db.oneOrNone("SELECT account_id FROM wa_bindings WHERE routing_code=$1", [routing_code]);
      if (bind) {
        // free this number from any other account binding to avoid UNIQUE conflicts
        await db.none("UPDATE wa_bindings SET wa_number=NULL WHERE wa_number=$1 AND account_id<>$2", [from, bind.account_id]);
        await db.none("UPDATE wa_bindings SET wa_number=$1, bound_at=now() WHERE account_id=$2", [from, bind.account_id]);
        row = bind;
      }
    }
    if (!row) {
      row = await db.oneOrNone("SELECT account_id FROM wa_bindings WHERE wa_number=$1", [from]);
    }
    if (!row) return res.status(403).json({ error: "Unbound WA number. Send your routing code first." });

    const accountId = row.account_id;

    if (text && (!routing_code || !text.toUpperCase().startsWith(routing_code))) {
      const msgBytes = Buffer.from(text, "utf8");
      await ingestFile({
        accountId,
        who: from,
        bytes: msgBytes,
        title: `WA ${from} ${new Date().toISOString()}.txt`,
        source: "whatsapp",
        path: `wa:${from}`
      });
    }

    if (media?.bytes_base64) {
      const buf = Buffer.from(media.bytes_base64, "base64");
      await ingestFile({
        accountId,
        who: from,
        bytes: buf,
        title: media.filename || `wa-${Date.now()}`,
        source: "whatsapp",
        path: `wa:${from}:media:${media.filename || "file"}`
      });
    }

    await db.none(
      `INSERT INTO audit(account_id, who, action, subject, details)
       VALUES($1,$2,'ingest','whatsapp',$3)`,
      [accountId, from, { hasMedia: !!media, textPreview: (text || "").slice(0, 120) }]
    );

    res.json({ ok: true });
  } catch (e:any) {
    console.error(e);
    res.status(500).json({ error: e.message || "bridge error" });
  }
});

export default router;
