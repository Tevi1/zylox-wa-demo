import "dotenv/config";
import express from "express";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - using JS module without types in this demo
import cors from "cors";
import { db } from "./services/db.js";
import fs from "fs";
import path from "path";
import whatsappBridge from "./routes/whatsappBridge.js";
import indexList from "./routes/indexList.js";
import audit from "./routes/audit.js";
import chat from "./routes/chat.js";
import chatAgents from "./routes/chatAgents.js";
import upload from "./routes/upload.js";
import admin from "./routes/admin.js";

const app = express();
app.use(cors({
  origin: true, // Allow all origins temporarily for debugging
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-user-id"],
  credentials: false
}));
// Handle CORS preflight for all routes
app.options('*', cors({
  origin: true, // Allow all origins temporarily for debugging
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-user-id"],
  credentials: false
}));
app.use(express.json({ limit: "50mb" }));

app.use(whatsappBridge);
app.use(indexList);
app.use(audit);
app.use(chat);
app.use(chatAgents);
app.use(upload);
app.use(admin);

const PORT = Number(process.env.PORT || 3002);

// lightweight health probe
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// test endpoint for debugging
app.get("/test", (_req, res) => res.json({ message: "Server is working", timestamp: new Date().toISOString() }));

app.listen(PORT, async () => {
  // bootstrap DB: run schema and create a demo account + routing
  const schema = fs.readFileSync(path.join(process.cwd(), "src/sql/schema.sql"), "utf-8");
  await db.none(schema);

  // ensure a demo account + binding (routing code e.g., ZY-4K7R2X)
  const accountId = "11111111-1111-1111-1111-111111111111";
  const code = "ZY-4K7R2X";
  await db.none("INSERT INTO accounts(account_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING", [accountId, "Demo"]);
  await db.none(
    "INSERT INTO wa_bindings(account_id,routing_code) VALUES($1,$2) ON CONFLICT (account_id) DO NOTHING",
    [accountId, code]
  );

  console.log(`API on http://localhost:${PORT}`);
  console.log(`Demo accountId: ${accountId}  routing_code: ${code}`);
  console.log(`CORS enabled for Vercel domains`);
});
