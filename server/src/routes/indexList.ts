import express from "express";
import crypto from "crypto";
import { db } from "../services/db.js";
const router = express.Router();

// dev header auth helper
function getUid(req: express.Request): string | null {
  const uid = req.header("x-user-id");
  return uid && uid.trim() ? uid.trim() : null;
}

// generate routing code function
function generateRoutingCode() {
  // AA-XXXXXX uppercase alnum
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const alnum = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const a = letters[Math.floor(Math.random() * letters.length)];
  const b = letters[Math.floor(Math.random() * letters.length)];
  const rest = Array.from({ length: 6 }, () => alnum[Math.floor(Math.random() * alnum.length)]).join("");
  return `${a}${b}-${rest}`;
}

router.post("/account/init", async (req, res) => {
  const body = req.body || {};
  const uid: string | null = (body.uid || getUid(req) || null);
  const name: string | undefined = body.name;
  if (!uid) return res.status(400).json({ error: "uid required" });

  // if exists, return mapping
  const existing = await db.oneOrNone(
    "SELECT ua.account_id, wb.routing_code FROM user_accounts ua LEFT JOIN wa_bindings wb ON wb.account_id = ua.account_id WHERE ua.uid=$1",
    [uid]
  );
  if (existing) return res.json({ accountId: existing.account_id, routing_code: existing.routing_code });

  // create account + mapping + routing code
  const accountId = crypto.randomUUID();
  await db.tx(async (t) => {
    await t.none("INSERT INTO accounts(account_id,name) VALUES($1,$2)", [accountId, name || "User"]);
    await t.none("INSERT INTO user_accounts(uid,account_id) VALUES($1,$2)", [uid, accountId]);
    const code = generateRoutingCode();
    await t.none("INSERT INTO wa_bindings(account_id,routing_code) VALUES($1,$2)", [accountId, code]);
  });
  const mapping = await db.one(
    "SELECT wb.routing_code FROM wa_bindings wb WHERE wb.account_id=$1",
    [accountId]
  );
  res.json({ accountId, routing_code: mapping.routing_code });
});

router.get("/account/me", async (req, res) => {
  const uid = getUid(req);
  if (!uid) return res.status(400).json({ error: "x-user-id required" });
  const row = await db.oneOrNone(
    "SELECT ua.account_id, wb.routing_code FROM user_accounts ua LEFT JOIN wa_bindings wb ON wb.account_id = ua.account_id WHERE ua.uid=$1",
    [uid]
  );
  if (!row) return res.status(404).json({ error: "not found" });
  res.json({ accountId: row.account_id, routing_code: row.routing_code });
});
router.get("/index/:accountId", async (req, res) => {
  const { accountId } = req.params;
  const rows = await db.manyOrNone(
    "SELECT doc_id,title,source,status,created_at FROM documents WHERE account_id=$1 ORDER BY created_at DESC LIMIT 50",
    [accountId]
  );
  res.json(rows);
});
export default router;
