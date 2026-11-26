-- 018 · Mirqam Pager plan (standalone product sold on the loyalty platform).
-- One row per workspace: a 14-day trial (no card) or a subscription billed by
-- mirqam-billing under the sub-account `pager:<tenant_id>`. The row is a cache of
-- that entitlement; pos_* columns track what was last pushed to the POS API
-- (tenant product `pager` on/off) so a failed push is retried by the lifecycle job.
CREATE TABLE pager_subscriptions (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants(id),
  tier             text NOT NULL CHECK (tier IN ('basic', 'plus')),
  cycle            text CHECK (cycle IN ('monthly', 'yearly')),
  branches         integer NOT NULL DEFAULT 1 CHECK (branches BETWEEN 1 AND 50),
  with_loyalty     boolean NOT NULL DEFAULT false,
  status           text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'suspended', 'canceled', 'expired')),
  source           text NOT NULL CHECK (source IN ('trial', 'billing')),
  expires_at       timestamptz NOT NULL,
  trial_started_at timestamptz,
  billing_version  bigint NOT NULL DEFAULT 0,
  pos_tenant       text CHECK (pos_tenant IS NULL OR length(pos_tenant) <= 100),
  pos_state        text CHECK (pos_state IN ('on', 'off')),
  pos_synced_at    timestamptz,
  pos_error        text CHECK (pos_error IS NULL OR length(pos_error) <= 100),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pager_subscriptions_sync_idx ON pager_subscriptions (updated_at);
