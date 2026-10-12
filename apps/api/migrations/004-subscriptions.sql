CREATE TABLE subscription_checkouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 request_key text NOT NULL, cycle text NOT NULL CHECK(cycle IN ('monthly','yearly')),
 amount integer NOT NULL CHECK(amount > 0), currency text NOT NULL DEFAULT 'SAR' CHECK(currency='SAR'),
 invoice_id text UNIQUE, checkout_url text, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid')),
 payment_id text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz,
 UNIQUE(tenant_id, request_key), UNIQUE(id,tenant_id)
);
CREATE TABLE subscriptions (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), cycle text NOT NULL CHECK(cycle IN ('monthly','yearly')),
 expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
