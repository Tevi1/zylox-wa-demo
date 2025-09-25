CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS accounts (
  account_id UUID PRIMARY KEY,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wa_bindings (
  account_id UUID PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
  wa_number TEXT UNIQUE,
  routing_code TEXT UNIQUE NOT NULL,
  bound_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS documents (
  doc_id TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source TEXT CHECK (source IN ('whatsapp','email','upload','drive')) NOT NULL,
  path TEXT,
  checksum TEXT,
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT CHECK (status IN ('queued','indexing','indexed','error')) NOT NULL,
  meta JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  doc_id TEXT REFERENCES documents(doc_id) ON DELETE CASCADE,
  offset_tok INT,
  length_tok INT,
  text TEXT,
  page INT,
  section TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 1536 dims (OpenAI text-embedding-3-small)
CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id TEXT PRIMARY KEY REFERENCES chunks(chunk_id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  vector vector(1536)
);
CREATE INDEX IF NOT EXISTS embeddings_idx ON embeddings USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS audit (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  who TEXT,
  action TEXT,
  subject TEXT,
  details JSONB,
  at TIMESTAMPTZ DEFAULT now()
);

-- Map app user IDs to vector account IDs
CREATE TABLE IF NOT EXISTS user_accounts (
  uid TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);
