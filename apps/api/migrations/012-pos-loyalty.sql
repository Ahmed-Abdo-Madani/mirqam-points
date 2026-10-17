-- POS sales use the native append-only loyalty ledger, never a second balance.
CREATE TABLE pos_loyalty_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 pos_tenant text NOT NULL UNIQUE,
 program_id uuid NOT NULL,
 points_per_sar integer NOT NULL CHECK(points_per_sar BETWEEN 1 AND 1000000),
 stamp_reward_minor bigint NOT NULL CHECK(stamp_reward_minor BETWEEN 0 AND 100000000),
 FOREIGN KEY(program_id,tenant_id) REFERENCES programs(id,tenant_id)
);
CREATE TABLE pos_loyalty_sales (
 tenant_id uuid NOT NULL,
 pos_tenant text NOT NULL,
 order_ref text NOT NULL CHECK(length(order_ref) BETWEEN 1 AND 120),
 request_hash text NOT NULL,
 account_id uuid,
 program_id uuid,
 purchase_minor bigint NOT NULL DEFAULT 0 CHECK(purchase_minor>=0),
 discount_minor bigint NOT NULL DEFAULT 0 CHECK(discount_minor>=0),
 earn_units integer NOT NULL DEFAULT 0 CHECK(earn_units>=0),
 redeemed integer NOT NULL DEFAULT 0 CHECK(redeemed>=0),
 state text NOT NULL CHECK(state IN ('OPEN','PAID','REVERSED')),
 earn_entry uuid REFERENCES ledger_entries(id),
 redeem_entry uuid REFERENCES ledger_entries(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,pos_tenant,order_ref),
 FOREIGN KEY(account_id,tenant_id) REFERENCES accounts(id,tenant_id),
 FOREIGN KEY(program_id,tenant_id) REFERENCES programs(id,tenant_id)
);
CREATE TABLE pos_loyalty_imports (
 tenant_id uuid NOT NULL,
 pos_tenant text NOT NULL,
 source_ref text NOT NULL,
 request_hash text NOT NULL,
 account_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,pos_tenant,source_ref),
 FOREIGN KEY(account_id,tenant_id) REFERENCES accounts(id,tenant_id)
);
