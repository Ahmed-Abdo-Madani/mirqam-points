-- 019 · Pager Basic is included with a paid Mirqam Loyalty plan; Plus is a paid upgrade (2026-11-28).
-- A workspace whose pager comes from its Loyalty plan gets a row with source 'loyalty' (created on its
-- first visit to the Pager tab): it carries the POS push tracking (pos_*) like trial and billing rows.
-- included_since + loyalty_action: what was done to a paid pager subscription because of the Loyalty plan
-- (never refunded automatically; listed in HQ admin for Mirqam to settle by hand):
--   renewal_stopped   a Basic subscription, now included: renewal stopped at period end
--   price_switched    a Plus subscription at 49/490: switched to the Loyalty Plus price from its next renewal
--   standalone_scheduled  a Plus subscription at the Loyalty price whose Loyalty plan lapsed: runs to its end,
--                     then renews at 49/490 (scheduled in billing, shown in the Pager tab and the renewal notice first)
--   stopped_on_lapse  the same, when billing cannot schedule the price rise without charging now: renewal
--                     stopped, the owner re-subscribes at 49/490, shown before the charge
ALTER TABLE pager_subscriptions DROP CONSTRAINT IF EXISTS pager_subscriptions_source_check;
ALTER TABLE pager_subscriptions ADD CONSTRAINT pager_subscriptions_source_check CHECK (source IN ('trial', 'billing', 'loyalty'));
ALTER TABLE pager_subscriptions ADD COLUMN included_since timestamptz;
ALTER TABLE pager_subscriptions ADD COLUMN loyalty_action text CHECK (loyalty_action IN ('renewal_stopped', 'price_switched', 'standalone_scheduled', 'stopped_on_lapse'));
