-- Opaque account-association proofs. No ledger data or reusable native sessions.
CREATE TABLE pos_account_links (
  key text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_account_links_tenant ON pos_account_links(tenant_id);
