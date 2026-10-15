-- 004 · Campaigns: merchant messages delivered to customers as wallet-pass notifications.
-- A campaign is immutable once sent. campaign_recipients records exactly which
-- passes (accounts) received it, so each pass can show its latest message and the
-- audience of a past campaign stays reproducible after members change consent.
CREATE TABLE campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  program_id       uuid NOT NULL,
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 40),
  body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 200),
  audience         text NOT NULL CHECK (audience IN ('consented', 'all')),
  recipients       integer NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  status           text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent')),
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  idempotency_key  text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash     text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (program_id, tenant_id) REFERENCES programs (id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX campaigns_tenant_idx ON campaigns (tenant_id, created_at DESC);
CREATE INDEX campaigns_program_idx ON campaigns (program_id, created_at DESC);

CREATE TABLE campaign_recipients (
  campaign_id  uuid NOT NULL,
  tenant_id    uuid NOT NULL,
  account_id   uuid NOT NULL,
  PRIMARY KEY (campaign_id, account_id),
  FOREIGN KEY (campaign_id, tenant_id) REFERENCES campaigns (id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, tenant_id) REFERENCES accounts (id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX campaign_recipients_account_idx ON campaign_recipients (account_id, campaign_id);
