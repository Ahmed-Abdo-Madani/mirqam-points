-- 016 · Account deletion (Google Play / App Store / PDPL).
--
-- * Owner deletion closes the workspace and PURGES it (apps/api/src/account-deletion.js):
--   purge_after is when the purge is due (immediately), purged_at when it ran.
--   Only billing records (subscription_checkouts) outlive the purge, for the
--   legal tax-retention period; the tenant row then stays as an anonymous
--   tombstone so those records keep their foreign key.
-- * A deleted login is anonymised in place (users.deleted_at) while ledger
--   entries it recorded still reference it, and hard-deleted otherwise.
-- * A member can be erased on request: personal data is wiped (members.erased_at),
--   the anonymous row keeps the store's points history consistent.
ALTER TABLE tenants
  ADD COLUMN purge_after timestamptz,
  ADD COLUMN purged_at timestamptz;
CREATE INDEX tenants_purge_due_idx ON tenants (purge_after) WHERE purge_after IS NOT NULL AND purged_at IS NULL;

ALTER TABLE users ADD COLUMN deleted_at timestamptz;

ALTER TABLE members ADD COLUMN erased_at timestamptz;
ALTER TABLE members ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE members ADD CONSTRAINT members_phone_unless_erased CHECK (phone IS NOT NULL OR erased_at IS NOT NULL);

-- Deleting a user sets actor_user_id NULL on the entries they recorded; these
-- indexes keep the "is this user still referenced?" checks cheap.
CREATE INDEX ledger_entries_actor_idx ON ledger_entries (actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE INDEX gift_card_entries_actor_idx ON gift_card_entries (actor_user_id) WHERE actor_user_id IS NOT NULL;

-- The ledgers stay append-only. The single exception: deleting the rows of a
-- CLOSED workspace inside the purge transaction, which declares that tenant
-- with set_config('mirqam.purge_tenant', <tenant id>, true). UPDATE is never allowed.
CREATE OR REPLACE FUNCTION ledger_entries_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('mirqam.purge_tenant', true) = OLD.tenant_id::text
     AND EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id AND closed_at IS NOT NULL) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ledger_entries is append-only (% blocked)', TG_OP USING ERRCODE = 'P0001';
END
$$;

CREATE OR REPLACE FUNCTION gift_card_entries_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('mirqam.purge_tenant', true) = OLD.tenant_id::text
     AND EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id AND closed_at IS NOT NULL) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'gift_card_entries is append-only (% blocked)', TG_OP USING ERRCODE = 'P0001';
END
$$;

-- Workspaces closed by an owner's deletion before this release kept all their
-- data. Their owners asked for deletion, so they are due for the purge now.
UPDATE tenants SET purge_after = now() WHERE closed_at IS NOT NULL AND purge_after IS NULL;

-- Staff removed before this release kept their login row (email, name, password
-- hash) with no workspace left. Erase them like a removal does now: anonymise,
-- then delete the rows no ledger entry refers to.
UPDATE users u
   SET email = 'deleted-' || u.id || '@deleted.invalid', name = 'deleted', password_hash = 'deleted',
       locale = 'ar', email_verified_at = NULL, deleted_at = now()
 WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id);
DELETE FROM sessions s USING users u WHERE s.user_id = u.id AND u.deleted_at IS NOT NULL;
DELETE FROM social_identities s USING users u WHERE s.user_id = u.id AND u.deleted_at IS NOT NULL;
DELETE FROM users u
 WHERE u.deleted_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.actor_user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM gift_card_entries g WHERE g.actor_user_id = u.id);
