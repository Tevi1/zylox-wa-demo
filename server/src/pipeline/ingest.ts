import crypto from "crypto";
import { randomUUID } from "crypto";
import { db } from "../services/db.js";
import { chunkText } from "./chunker.js";
import { embedBatch } from "./embeddings.js";
import { normalizeBytesToText } from "./normalize.js";

type IngestInput = {
  accountId: string;
  bytes: Buffer;
  title: string;
  source: "whatsapp"|"email"|"upload"|"drive";
  path?: string;
  who?: string;
};

export async function ingestFile(inp: IngestInput) {
  const checksum = crypto.createHash("md5").update(inp.bytes).digest("hex");
  const docId = randomUUID();

  await db.tx(async (t) => {
    await t.none(
      `INSERT INTO documents(doc_id,account_id,title,source,path,checksum,status)
       VALUES($1,$2,$3,$4,$5,$6,'indexing')`,
      [docId, inp.accountId, inp.title, inp.source, inp.path ?? null, checksum]
    );

    const text = await normalizeBytesToText(inp.bytes);
    const chunks = chunkText(text, { minTokens: 500, maxTokens: 1200, overlap: 120 });

    const chunkRows = chunks.map((c, i) => ({
      chunk_id: randomUUID(),
      account_id: inp.accountId,
      doc_id: docId,
      offset_tok: c.offset ?? i*1000,
      length_tok: c.length,
      text: c.text,
      page: 1,
      section: null
    }));

    // bulk insert chunks
    const pgp = db.$config.pgp;
    await t.none(pgp.helpers.insert(chunkRows, new pgp.helpers.ColumnSet([
      "chunk_id","account_id","doc_id","offset_tok","length_tok","text","page","section"
    ], { table: "chunks" })));

    // embeddings
    const vectors = await embedBatch(chunkRows.map(r => r.text));
    const embRows = chunkRows.map((r, i) => ({ chunk_id: r.chunk_id, account_id: inp.accountId, vector: vectors[i] }));
    await t.none(pgp.helpers.insert(embRows, new pgp.helpers.ColumnSet(["chunk_id","account_id","vector"], { table: "embeddings" })));

    await t.none(`UPDATE documents SET status='indexed' WHERE doc_id=$1`, [docId]);
  });

  await db.none(`INSERT INTO audit(account_id, who, action, subject, details)
                 VALUES($1,$2,'ingest',$3,$4)`,
                [inp.accountId, inp.who || "whatsapp", "doc:"+docId, { title: inp.title, source: inp.source }]);

  return { docId };
}
