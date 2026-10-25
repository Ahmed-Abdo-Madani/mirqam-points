-- Loyalty built into the Mirqam POS console: one workspace per POS tenant,
-- kept on the POS subscription (managed_until) instead of its own billing.
CREATE TABLE pos_native_tenants (
  pos_tenant text PRIMARY KEY,
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  managed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
