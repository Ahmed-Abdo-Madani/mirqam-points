-- 019 · The pager is included with a paid Mirqam Loyalty plan (2026-11-28).
-- A workspace whose pager comes from its Loyalty plan gets a row with source 'loyalty' (created on its
-- first visit to the Pager tab): it carries the POS push tracking (pos_*) like trial and billing rows.
-- included_since: when a paid pager subscription's renewal was stopped because Loyalty took over
-- (never refunded automatically; listed in HQ admin for Mirqam to settle by hand).
ALTER TABLE pager_subscriptions DROP CONSTRAINT IF EXISTS pager_subscriptions_source_check;
ALTER TABLE pager_subscriptions ADD CONSTRAINT pager_subscriptions_source_check CHECK (source IN ('trial', 'billing', 'loyalty'));
ALTER TABLE pager_subscriptions ADD COLUMN included_since timestamptz;
