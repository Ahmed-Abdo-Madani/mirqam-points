-- 002 · Wallet passes, self-enrollment and gift cards.

-- ---------------------------------------------------------------- pass design
-- Merchant-facing pass look per program (colours, reward text). Validated in app code.
ALTER TABLE programs ADD COLUMN design jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Programs can opt in to public self-enrollment (QR poster at the counter).
ALTER TABLE programs ADD COLUMN self_enroll boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- pass identity
-- Each account carries:
--   code         short value printed in the pass barcode; the cashier scans it.
--   pass_token   opaque token in the public pass URL (/p/:token).
--   apple_auth   per-pass secret Apple Wallet sends back to the web service.
--   pass_version bumps on "reissue": old passes stop resolving and new ones get
--                new identifiers, so a pass held by the wrong person is dead.
ALTER TABLE accounts
  ADD COLUMN code text NOT NULL DEFAULT upper(substr(md5(gen_random_uuid()::text), 1, 10)),
  ADD COLUMN pass_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  ADD COLUMN apple_auth text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  ADD COLUMN pass_version integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX accounts_code_key ON accounts (tenant_id, code);
CREATE UNIQUE INDEX accounts_pass_token_key ON accounts (pass_token);

-- Self-enrolled members have not proven they own the phone number.
ALTER TABLE members ADD COLUMN verified boolean NOT NULL DEFAULT true;

-- Apple Wallet device registrations (PassKit web service).
CREATE TABLE apple_registrations (
  device_id       text NOT NULL CHECK (length(device_id) <= 128),
  pass_type_id    text NOT NULL,
  serial          text NOT NULL,
  push_token      text NOT NULL CHECK (length(push_token) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, pass_type_id, serial)
);
CREATE INDEX apple_registrations_serial_idx ON apple_registrations (serial);

-- ---------------------------------------------------------------- tenants
ALTER TABLE tenants ADD COLUMN closed_at timestamptz;

-- ---------------------------------------------------------------- gift cards
-- Stored value in integer halalas. The code is a bearer secret: only its
-- SHA-256 is stored; last4 is kept for display. public_token opens the
-- recipient's card page (/gift/:token) which can reveal the code to its holder.
CREATE TABLE gift_cards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  code_hash        text NOT NULL UNIQUE,
  code_last4       text NOT NULL,
  code_sealed      text NOT NULL,
  public_token     text NOT NULL UNIQUE,
  apple_auth       text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  initial_minor    bigint NOT NULL CHECK (initial_minor > 0 AND initial_minor <= 100000000),
  balance_minor    bigint NOT NULL CHECK (balance_minor >= 0),
  currency         text NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'voided')),
  expires_at       timestamptz,
  recipient_name   text CHECK (recipient_name IS NULL OR length(recipient_name) <= 120),
  recipient_phone  text CHECK (recipient_phone IS NULL OR recipient_phone ~ '^\+[1-9][0-9]{6,14}$'),
  sender_name      text CHECK (sender_name IS NULL OR length(sender_name) <= 120),
  message          text CHECK (message IS NULL OR length(message) <= 300),
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
CREATE INDEX gift_cards_tenant_idx ON gift_cards (tenant_id, created_at DESC);

CREATE TABLE gift_card_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  gift_card_id      uuid NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('issue', 'redeem', 'refund', 'void')),
  amount_minor      bigint NOT NULL CHECK (amount_minor <> 0),
  balance_after     bigint NOT NULL CHECK (balance_after >= 0),
  ref               text CHECK (ref IS NULL OR length(ref) <= 120),
  note              text CHECK (note IS NULL OR length(note) <= 500),
  actor_user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  idempotency_key   text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash      text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (gift_card_id, tenant_id) REFERENCES gift_cards (id, tenant_id) ON DELETE RESTRICT,
  CHECK (kind NOT IN ('issue', 'refund') OR amount_minor > 0),
  CHECK (kind <> 'redeem' OR amount_minor < 0)
);
CREATE INDEX gift_card_entries_card_idx ON gift_card_entries (gift_card_id, created_at DESC);

CREATE FUNCTION gift_card_entries_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'gift_card_entries is append-only (% blocked)', TG_OP USING ERRCODE = 'P0001';
END
$$;

CREATE TRIGGER gift_card_entries_no_mutation
  BEFORE UPDATE OR DELETE ON gift_card_entries
  FOR EACH ROW EXECUTE FUNCTION gift_card_entries_append_only();
