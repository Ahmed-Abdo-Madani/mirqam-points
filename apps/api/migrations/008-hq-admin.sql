-- Dedicated HQ access. Tenant roles and customer sessions remain unchanged.
CREATE TABLE hq_admin_access (
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 bridge_key text NOT NULL CHECK (bridge_key ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,user_id),
 FOREIGN KEY (tenant_id,user_id) REFERENCES memberships(tenant_id,user_id) ON DELETE CASCADE
);
