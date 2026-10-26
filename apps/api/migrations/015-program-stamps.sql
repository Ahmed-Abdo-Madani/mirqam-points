-- Custom stamp artwork per program (PNG), drawn on the wallet card's stamp strip.
CREATE TABLE program_stamps (
  program_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  png bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (program_id, tenant_id) REFERENCES programs(id, tenant_id) ON DELETE CASCADE
);
