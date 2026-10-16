-- Stable POS owner identities: reconnecting never creates a fresh trial.
CREATE TABLE pos_provisioned_accounts (
 subject text PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id, user_id)
);
