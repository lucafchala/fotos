-- Image-use consent audit trail (Part 5).
-- Append-only record of each acceptance at the moment of Drive access.
-- Apply with:  npx wrangler d1 migrations apply fotos-consent --remote
CREATE TABLE IF NOT EXISTS image_use_consent (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,            -- ISO-8601 UTC, server time
  event_slug      TEXT NOT NULL,
  event_title     TEXT,
  drive_target    TEXT,                     -- 'full' | 'instagram'
  terms_version   TEXT NOT NULL,            -- Terms "Atualizada em" date accepted
  terms_hash      TEXT,                     -- SHA-256 of the exact Terms text shown
  consent_text    TEXT,                     -- verbatim checkbox label accepted
  consenter_name  TEXT,                     -- optional, only if the visitor provided it
  turnstile_ok    INTEGER NOT NULL DEFAULT 0,
  ip              TEXT,                     -- CF-Connecting-IP
  country         TEXT,
  region          TEXT,
  city            TEXT,
  timezone        TEXT,
  asn             INTEGER,
  as_org          TEXT,                     -- ISP / network organisation
  colo            TEXT,                     -- Cloudflare data center
  user_agent      TEXT,
  accept_language TEXT,
  referrer        TEXT,
  page_url        TEXT
);

CREATE INDEX IF NOT EXISTS idx_consent_slug ON image_use_consent (event_slug);
CREATE INDEX IF NOT EXISTS idx_consent_created ON image_use_consent (created_at);
