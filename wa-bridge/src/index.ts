import "dotenv/config";
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage, DisconnectReason } from "@whiskeysockets/baileys";
import Pino from "pino";
import axios from "axios";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - types are optional for this demo
import qrcode from "qrcode-terminal";
import fs from "fs/promises";
import { Boom } from "@hapi/boom";

// Force IPv4 loopback to avoid occasional IPv6 resolution flapping
const POST_URL = process.env.POST_URL || "http://127.0.0.1:3000/ingest/whatsapp-bridge";
const ROUTING_RE = /^([A-Z]{2}-[A-Z0-9]{6})\b/; // e.g., ZY-4K7R2X

// Robust posting with retry/queue
async function postWithRetry(url: string, payload: any, maxRetries = 5) {
  let n = 0, backoff = 300;
  // jittered exponential backoff
  while (true) {
    try {
      return await axios.post(url, payload, { timeout: 8000 });
    } catch (e) {
      n++;
      if (n > maxRetries) throw e;
      await new Promise(r => setTimeout(r, backoff + Math.random() * 150));
      backoff *= 2;
    }
  }
}

const offlineQueue: any[] = [];
let apiHealthy = false;
let lastHealth: boolean | null = null;

async function checkApiHealth() {
  try {
    const healthUrl = POST_URL.replace("/ingest/whatsapp-bridge", "/health");
    await axios.get(healthUrl, { timeout: 4000 });
    apiHealthy = true;
  } catch {
    apiHealthy = false;
  }
  if (lastHealth !== apiHealthy) {
    console.log("API health:", apiHealthy ? "up" : "down");
    lastHealth = apiHealthy;
  }
}

async function flushQueue() {
  if (!apiHealthy) return;
  while (offlineQueue.length && apiHealthy) {
    const item = offlineQueue[0];
    try {
      await postWithRetry(POST_URL, item);
      offlineQueue.shift();
      console.log("Flushed queued msg. queueLen=", offlineQueue.length);
    } catch {
      console.log("Flush halted; API still failing. queueLen=", offlineQueue.length);
      break; // stop if still failing; will try again on next tick
    }
  }
}

// periodic health + queue flush (single global interval)
setInterval(async () => { await checkApiHealth(); await flushQueue(); }, 2000);

async function startSock() {
  // simple reconnect backoff
  // will be reset to 500ms when connection opens
  // doubles up to 10s to avoid tight loops
  // scoped outside handler via closure
  let reconnectDelayMs = 500;
  const { state, saveCreds } = await useMultiFileAuthState("./wa_auth");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger: Pino({ level: "info" }),
    connectTimeoutMs: 20000,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    emitOwnEvents: false,
    browser: ["Zylox Agent","Chrome","124"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u:any) => {
    const { qr, connection, lastDisconnect } = u;
    if (qr) {
      console.log("Scan this QR with WhatsApp:");
      qrcode.generate(qr, { small: true });
      console.log("QR token preview:", qr.slice(0, 16), "...");
    }
    if (connection === "open") {
      console.log("connection: open");
      reconnectDelayMs = 500;
    }
    if (connection === "close") {
      const status = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log("connection closed, status:", status);
      // backoff before attempting next connection to avoid hammering
      await new Promise(r => setTimeout(r, reconnectDelayMs));
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10000);
      switch (status) {
        case DisconnectReason.restartRequired:
        case DisconnectReason.connectionClosed:
        case DisconnectReason.connectionLost:
        case DisconnectReason.timedOut:
          return startSock();
        case DisconnectReason.connectionReplaced:
          await fs.rm("./wa_auth", { recursive: true, force: true });
          return startSock();
        case DisconnectReason.loggedOut:
        case DisconnectReason.badSession:
          await fs.rm("./wa_auth", { recursive: true, force: true });
          return startSock();
        default:
          return startSock();
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }:any) => {
    for (const m of messages) {
      try {
        const from = m.key.remoteJid || "";
        const msg = m.message;
        if (!msg) continue;

        const text =
          (msg.conversation) ||
          (msg.extendedTextMessage?.text) ||
          (msg as any).documentWithCaptionMessage?.message?.conversation ||
          "";

        const codeMatch = text ? ROUTING_RE.exec(text.toUpperCase()) : null;

        console.log("WA msg", {
          from,
          hasMedia: !!(msg.imageMessage || msg.documentMessage || msg.videoMessage || msg.audioMessage),
          textPreview: (text || "").slice(0, 80)
        });

        const hasMedia = !!(msg.imageMessage || msg.documentMessage || msg.videoMessage || msg.audioMessage);
        let mediaPayload: any = null;
        if (hasMedia) {
          const buf = (await downloadMediaMessage(m, "buffer", {})) as Buffer;
          const mimetype =
            msg.documentMessage?.mimetype ||
            msg.imageMessage?.mimetype ||
            msg.videoMessage?.mimetype ||
            msg.audioMessage?.mimetype ||
            "application/octet-stream";
          const filename = msg.documentMessage?.fileName || `wa-${Date.now()}`;
          mediaPayload = {
            filename,
            contentType: mimetype,
            bytes_base64: buf.toString("base64")
          };
        }

        const payload: any = { from, routing_code: codeMatch?.[1] || null, text, media: mediaPayload };
        if (payload.routing_code && payload.text?.toUpperCase().startsWith(payload.routing_code)) {
          payload.text = payload.text.slice(payload.routing_code.length).trim();
        }
        if (apiHealthy) {
          try {
            const resp = await postWithRetry(POST_URL, payload);
            console.log("Bridge POST ok", { status: resp.status, textLen: (payload.text || "").length, hasMedia: !!mediaPayload });
          } catch {
            offlineQueue.push(payload);
          }
        } else {
          offlineQueue.push(payload);
        }

      } catch (e) {
        console.error("WA bridge error", e);
      }
    }
  });
}

startSock().catch(console.error);
