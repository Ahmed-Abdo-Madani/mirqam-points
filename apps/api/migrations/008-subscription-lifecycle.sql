-- 008 · Subscription lifecycle: an append-only event log per workspace.
-- Every state change (activated, renewed, plan changed, payment failed, expiry
-- reminders, expired) is one row. The row is both the in-app notification feed
-- and the email outbox: email_status tracks delivery so a transient provider
-- failure is retried by the lifecycle job. UNIQUE (tenant_id, kind, ref) makes
-- every event idempotent: webhooks, return-path confirmation and the hourly job
-- can all race and each event still fires exactly once.
CREATE TABLE subscription_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('activated', 'renewed', 'plan_changed', 'payment_failed', 'expiring_soon', 'expired')),
  ref             text NOT NULL CHECK (length(ref) <= 200),
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  email_status    text NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'skipped', 'failed')),
  email_attempts  integer NOT NULL DEFAULT 0,
  emailed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, ref)
);
CREATE INDEX subscription_events_tenant_idx ON subscription_events (tenant_id, created_at DESC);
CREATE INDEX subscription_events_outbox_idx ON subscription_events (created_at) WHERE email_status = 'pending';
