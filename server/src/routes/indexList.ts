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
  try {
    const body = req.body || {};
    const uid: string | null = (body.uid || getUid(req) || null);
    const name: string | undefined = body.name;
    if (!uid) return res.status(400).json({ error: "uid required" });

    // For now, return a mock response to test the route
    const accountId = crypto.randomUUID();
    const routing_code = generateRoutingCode();
    
    res.json({ 
      accountId, 
      routing_code,
      message: "Account initialized successfully (mock mode)"
    });
  } catch (error) {
    console.error("Account init error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/account/me", async (req, res) => {
  const uid = getUid(req);
  if (!uid) return res.status(400).json({ error: "x-user-id required" });
  
  // Return mock data for demo
  res.json({ 
    accountId: "demo-account-123",
    routing_code: "ZY-DEMO123",
    uid: uid
  });
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
