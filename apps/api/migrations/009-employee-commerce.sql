-- Staff attribution is additive; existing checkouts keep their original amounts and behavior.
ALTER TABLE subscription_checkouts ADD COLUMN coupon_code text NOT NULL DEFAULT '';
ALTER TABLE subscription_checkouts ADD COLUMN commerce_quote jsonb;
ALTER TABLE subscription_checkouts ADD COLUMN commerce_event jsonb;
ALTER TABLE subscription_checkouts ADD COLUMN commerce_state text NOT NULL DEFAULT 'none' CHECK (commerce_state IN ('none','awaiting_payment','pending','delivered','review'));
ALTER TABLE subscription_checkouts ADD COLUMN commerce_next_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE subscription_checkouts ADD COLUMN commerce_attempts integer NOT NULL DEFAULT 0;
CREATE INDEX subscription_commerce_due ON subscription_checkouts(commerce_next_at) WHERE commerce_state IN ('awaiting_payment','pending');
