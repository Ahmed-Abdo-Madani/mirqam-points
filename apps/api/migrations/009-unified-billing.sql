-- 009 · Unified billing (mirqam-billing). The subscriptions row becomes a cache
-- of the entitlement pushed by the billing service; these columns mirror it.
-- Workspaces billed by the old Moyasar-invoice flow keep working unchanged.
ALTER TABLE subscriptions
  ADD COLUMN status               text NOT NULL DEFAULT 'active' CHECK (status IN ('trialing', 'active', 'past_due', 'suspended', 'canceled', 'expired')),
  ADD COLUMN plan                 text,
  ADD COLUMN auto_renew           boolean NOT NULL DEFAULT false,
  ADD COLUMN cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN payment_method       jsonb,
  ADD COLUMN period_end           timestamptz,
  ADD COLUMN billing_version      bigint NOT NULL DEFAULT 0;
