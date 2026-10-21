-- 013 · WhatsApp number for subscription reminders (sent by mirqam-billing through Mirqam Bot).
ALTER TABLE tenants ADD COLUMN billing_phone text CHECK (billing_phone IS NULL OR billing_phone ~ '^\+[1-9][0-9]{6,14}$');
