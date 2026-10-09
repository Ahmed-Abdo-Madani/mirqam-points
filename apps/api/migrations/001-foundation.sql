-- 001 · Foundation: tenants, staff, sessions, programs, members and the points ledger.
--
-- Tenant isolation is enforced by the schema, not only by application code:
-- child rows reference their parent through (id, tenant_id) composite keys, so
-- an account can never point at another tenant's member or program, and a
-- ledger entry can never land on another tenant's account.

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  password_hash  text NOT NULL,
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  locale         text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar', 'en')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE memberships (
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'manager', 'cashier', 'analyst')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

-- Only a SHA-256 of the session token is stored; a database leak does not
-- yield usable sessions.
CREATE TABLE sessions (
  token_hash    text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE programs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  type        text NOT NULL CHECK (type IN ('points', 'stamps')),
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
CREATE INDEX programs_tenant_idx ON programs (tenant_id, created_at DESC);

CREATE TABLE members (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  phone              text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  name               text CHECK (name IS NULL OR length(name) BETWEEN 1 AND 120),
  email              text CHECK (email IS NULL OR length(email) BETWEEN 3 AND 254),
  locale             text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar', 'en')),
  marketing_consent  boolean NOT NULL DEFAULT false,
  consent_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone),
  UNIQUE (id, tenant_id)
);
CREATE INDEX members_tenant_created_idx ON members (tenant_id, created_at DESC);

-- Cached balance per member per program. The ledger is the source of truth;
-- the nightly reconciliation compares this cache to SUM(ledger_entries.amount).
CREATE TABLE accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  program_id       uuid NOT NULL,
  member_id        uuid NOT NULL,
  balance          bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned  bigint NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, member_id),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (program_id, tenant_id) REFERENCES programs (id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (member_id, tenant_id) REFERENCES members (id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX accounts_member_idx ON accounts (member_id);

-- Append-only. Corrections are new rows (adjust / void), never edits.
-- amount is signed: earn > 0, redeem and expire < 0, adjust either, void = -original.
CREATE TABLE ledger_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  account_id         uuid NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('earn', 'redeem', 'adjust', 'void', 'expire')),
  amount             bigint NOT NULL CHECK (amount <> 0),
  balance_after      bigint NOT NULL CHECK (balance_after >= 0),
  source             text NOT NULL DEFAULT 'console'
                     CHECK (source IN ('console', 'pos', 'api', 'salla', 'zid', 'campaign', 'system')),
  ref                text CHECK (ref IS NULL OR length(ref) <= 120),
  note               text CHECK (note IS NULL OR length(note) <= 500),
  purchase_minor     bigint CHECK (purchase_minor IS NULL OR purchase_minor >= 0),
  actor_user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  idempotency_key    text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash       text NOT NULL,
  reverses_entry_id  uuid UNIQUE REFERENCES ledger_entries (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (account_id, tenant_id) REFERENCES accounts (id, tenant_id) ON DELETE RESTRICT,
  CHECK ((kind = 'void') = (reverses_entry_id IS NOT NULL)),
  CHECK (kind <> 'earn' OR amount > 0),
  CHECK (kind NOT IN ('redeem', 'expire') OR amount < 0)
);
CREATE INDEX ledger_account_idx ON ledger_entries (account_id, created_at DESC);
CREATE INDEX ledger_tenant_idx ON ledger_entries (tenant_id, created_at DESC);

CREATE FUNCTION ledger_entries_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (% blocked)', TG_OP USING ERRCODE = 'P0001';
END
$$;

CREATE TRIGGER ledger_entries_no_mutation
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();

CREATE TABLE audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  actor_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  action         text NOT NULL,
  target         text,
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, created_at DESC);
