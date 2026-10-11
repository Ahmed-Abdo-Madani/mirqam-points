-- 003 · Merchant logo shown on wallet cards (PNG, validated and size-capped in app code).
ALTER TABLE tenants
  ADD COLUMN logo bytea,
  ADD COLUMN logo_version integer NOT NULL DEFAULT 0;
