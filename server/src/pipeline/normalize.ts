import { promisify } from "util";
import { execFile as execFileCb } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - demo usage without full type packages
import Tesseract from "tesseract.js";

const execFile = promisify(execFileCb);

async function tryPdfParse(bytes: Buffer): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - no types for pdf-parse in this demo
    const mod = await import("pdf-parse");
    const pdfParse = (mod as any).default || mod;
    const out = await pdfParse(bytes);
    const txt: string = String(out?.text || "").trim();
    if (txt && txt.replace(/[^A-Za-z]+/g, "").length >= 40) return txt;
  } catch (e) {
    console.warn("pdf-parse failed, will try OCR:", e);
  }
  return null;
}

async function ocrPdfWithPoppler(bytes: Buffer, maxPages = 10): Promise<string | null> {
  // Requires `pdftoppm` (Poppler) in PATH
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zy-ocr-"));
  const pdfPath = path.join(tmpDir, "in.pdf");
  await fs.writeFile(pdfPath, bytes);
  const outPrefix = path.join(tmpDir, "page");
  try {
    const args = ["-png", "-r", "200", "-f", "1", "-l", String(maxPages), pdfPath, outPrefix];
    await execFile("pdftoppm", args);
  } catch (e) {
    console.warn("pdftoppm not available or failed:", e);
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
    return null;
  }
  // Collect generated images (page-1.png, page-2.png, ...)
  const files = (await fs.readdir(tmpDir))
    .filter(f => f.startsWith("page-") && f.endsWith(".png"))
    .sort((a,b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));
  let outText = "";
  for (const f of files) {
    const p = path.join(tmpDir, f);
    try {
      const { data: { text } } = await Tesseract.recognize(p, "eng");
      if (text?.trim()) outText += "\n\n" + text;
    } catch (e) {
      console.warn("OCR failed for", f, e);
    }
  }
  try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
  const cleaned = outText.trim();
  return cleaned ? cleaned : null;
}

export async function normalizeBytesToText(bytes:Buffer): Promise<string>{
  const isPdf = bytes.slice(0,4).toString("ascii") === "%PDF";
  if (isPdf){
    // 1) Try text extraction via pdf-parse
    const parsed = await tryPdfParse(bytes);
    if (parsed) return parsed;
    // 2) Fallback to OCR via Poppler + Tesseract
    const ocr = await ocrPdfWithPoppler(bytes, 12);
    if (ocr) return ocr;
  }
  // Non-PDF or no extraction possible: treat as UTF-8 text
  return bytes.toString("utf8");
}

