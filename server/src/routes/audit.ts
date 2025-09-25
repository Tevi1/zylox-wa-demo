import express from "express";
import { db } from "../services/db.js";
const router = express.Router();
router.get("/audit/:accountId", async (req, res) => {
  const { accountId } = req.params;
  const rows = await db.manyOrNone(
    "SELECT who,action,subject,details,at FROM audit WHERE account_id=$1 ORDER BY at DESC LIMIT 100",
    [accountId]
  );
  res.json(rows);
});
export default router;
