-- address は plus 部分を除いた宛先。初めて届いたときに作られる
CREATE TABLE aliases (
  address TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
  notify INTEGER NOT NULL DEFAULT 0 CHECK (notify IN (0, 1)),
  discord_webhook TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  last_received_at TEXT,
  received_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL REFERENCES aliases (address),
  recipient TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT,
  received_at TEXT NOT NULL,
  size INTEGER NOT NULL,
  -- R2 の原文は 90 日で消えるので、古い行ではキーだけが残る
  raw_key TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('forwarded', 'rejected'))
);

CREATE INDEX messages_received_at ON messages (received_at DESC);
CREATE INDEX messages_alias ON messages (alias, received_at DESC);
