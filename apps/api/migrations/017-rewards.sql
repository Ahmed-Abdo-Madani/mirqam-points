-- Rewards catalogue: named rewards a member spends points/stamps on ("free coffee for 10 stamps").
-- The cashier redeems by picking a reward instead of typing a number; the cost is set by the merchant.
CREATE TABLE rewards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  program_id  uuid NOT NULL,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  cost        integer NOT NULL CHECK (cost BETWEEN 1 AND 10000000),
  -- item: a free product; percent: % off the bill (value 1-100); amount: halalas off the bill.
  kind        text NOT NULL CHECK (kind IN ('item', 'percent', 'amount')),
  value       integer CHECK (value IS NULL OR value > 0),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (program_id, tenant_id) REFERENCES programs(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX rewards_program_idx ON rewards (program_id, created_at);

-- Which reward a redemption paid for (and how many). Null for plain number redemptions.
ALTER TABLE ledger_entries ADD COLUMN reward_id uuid;
ALTER TABLE ledger_entries ADD COLUMN reward_qty integer CHECK (reward_qty IS NULL OR reward_qty > 0);
ALTER TABLE ledger_entries ADD FOREIGN KEY (reward_id, tenant_id) REFERENCES rewards(id, tenant_id) ON DELETE RESTRICT;
