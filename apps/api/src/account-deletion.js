/* Account deletion and erasure (Google Play account-deletion policy, App Store
   5.1.1(v), Saudi PDPL). The public explanation is /delete-account
   (apps/web/src/pages/public/DeleteAccount.jsx) — keep both in step.

   - An owner deletes their account: the login is erased and every workspace
     they alone own is closed and PURGED right away (purgeTenant): members,
     points/stamps ledger, programs, card designs and stamp art, campaigns,
     gift cards, staff logins, the logo, wallet-pass registrations, POS links,
     sessions, subscription notices and the audit log. If the purge fails, the
     hourly sweep (runPurges) retries it, so it completes within 24 hours.
   - Kept: billing records only (subscription_checkouts: amount, dates, coupon,
     provider invoice/payment ids — no customer data), for
     BILLING_RETENTION_YEARS after the year of payment, as the Saudi VAT rules
     require. The tenant row stays as an anonymous tombstone for their foreign
     key, and the sweep deletes both once the period ends. Workspaces without
     billing records leave nothing behind.
   - A staff member deletes their account or is removed: the login is erased
     (eraseUser); the workspace and the entries they recorded stay.
   - A member asks the store to erase them (eraseMember): phone, name, email and
     consent are wiped, their cards stop working, any balance is forfeited as an
     `expire` entry, and the anonymous row keeps the store's history consistent. */
import { forfeitBalance } from './ledger.js'

export const BILLING_RETENTION_YEARS = 10

/** Erases a login inside the caller's transaction. The row is anonymised (it may
    still be the actor of ledger entries) and deleted outright when nothing refers to it. */
export async function eraseUser(q, userId) {
  await q.query('DELETE FROM sessions WHERE user_id = $1', [userId])
  await q.query('DELETE FROM social_identities WHERE user_id = $1', [userId])
  await q.query('DELETE FROM memberships WHERE user_id = $1', [userId])
  await q.query(ANONYMISE_USERS, [[userId]])
  await pruneDeletedUsers(q, [userId])
}

const ANONYMISE_USERS = `
  UPDATE users SET email = 'deleted-' || id || '@deleted.invalid', name = 'deleted', password_hash = 'deleted',
                   locale = 'ar', email_verified_at = NULL, deleted_at = COALESCE(deleted_at, now())
   WHERE id = ANY($1::uuid[])`

/** Hard-deletes erased logins that no membership or ledger entry refers to any more. */
export async function pruneDeletedUsers(q, ids) {
  const { rowCount } = await q.query(
    `DELETE FROM users u
      WHERE u.deleted_at IS NOT NULL AND u.id = ANY($1::uuid[])
        AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.actor_user_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM gift_card_entries g WHERE g.actor_user_id = u.id)`,
    [ids],
  )
  return rowCount
}

/* Children first: every table holding the workspace's rows, in foreign-key order.
   The account-deletion test fails when a new tenant table is missing here. */
const PURGE = [
  [
    'walletRegistrations',
    `DELETE FROM apple_registrations WHERE split_part(serial, '-v', 1) IN
       (SELECT 'acct-' || id FROM accounts WHERE tenant_id = $1 UNION ALL SELECT 'gift-' || id FROM gift_cards WHERE tenant_id = $1)`,
  ],
  ['campaignRecipients', 'DELETE FROM campaign_recipients WHERE tenant_id = $1'],
  ['campaigns', 'DELETE FROM campaigns WHERE tenant_id = $1'],
  ['posSales', 'DELETE FROM pos_loyalty_sales WHERE tenant_id = $1'],
  ['posImports', 'DELETE FROM pos_loyalty_imports WHERE tenant_id = $1'],
  ['posSettings', 'DELETE FROM pos_loyalty_settings WHERE tenant_id = $1'],
  ['ledgerEntries', 'DELETE FROM ledger_entries WHERE tenant_id = $1'],
  ['accounts', 'DELETE FROM accounts WHERE tenant_id = $1'],
  ['members', 'DELETE FROM members WHERE tenant_id = $1'],
  ['stampArt', 'DELETE FROM program_stamps WHERE tenant_id = $1'],
  ['programs', 'DELETE FROM programs WHERE tenant_id = $1'],
  ['giftCardEntries', 'DELETE FROM gift_card_entries WHERE tenant_id = $1'],
  ['giftCards', 'DELETE FROM gift_cards WHERE tenant_id = $1'],
  ['posLinks', 'DELETE FROM pos_account_links WHERE tenant_id = $1'],
  ['posNative', 'DELETE FROM pos_native_tenants WHERE tenant_id = $1'],
  ['posAccounts', 'DELETE FROM pos_provisioned_accounts WHERE tenant_id = $1'],
  ['sessions', 'DELETE FROM sessions WHERE tenant_id = $1'],
  ['hqAccess', 'DELETE FROM hq_admin_access WHERE tenant_id = $1'],
  ['memberships', 'DELETE FROM memberships WHERE tenant_id = $1'],
  ['notices', 'DELETE FROM subscription_events WHERE tenant_id = $1'],
  ['entitlement', 'DELETE FROM subscriptions WHERE tenant_id = $1'],
  ['auditLog', 'DELETE FROM audit_log WHERE tenant_id = $1'],
]

/** Deletes a closed workspace's data. Returns null when there is nothing to purge
    (unknown, still open, or already purged), otherwise per-table row counts. */
export async function purgeTenant(db, tenantId, { wallet } = {}) {
  const result = await db.tx(async (tx) => {
    const {
      rows: [tenant],
    } = await tx.query('SELECT closed_at, purged_at FROM tenants WHERE id = $1 FOR UPDATE', [tenantId])
    if (!tenant?.closed_at || tenant.purged_at) return null
    // The only way past the ledgers' append-only triggers: this transaction, this closed tenant.
    await tx.query("SELECT set_config('mirqam.purge_tenant', $1, true)", [tenantId])
    // Read before deleting: the wallet cards Google holds, and every login that worked here.
    const { rows: cards } = await tx.query('SELECT id, pass_version AS version, code FROM accounts WHERE tenant_id = $1', [tenantId])
    const { rows: gifts } = await tx.query('SELECT id FROM gift_cards WHERE tenant_id = $1', [tenantId])
    const { rows: people } = await tx.query(
      `SELECT user_id AS id FROM memberships WHERE tenant_id = $1
       UNION SELECT actor_user_id FROM ledger_entries WHERE tenant_id = $1 AND actor_user_id IS NOT NULL
       UNION SELECT actor_user_id FROM gift_card_entries WHERE tenant_id = $1 AND actor_user_id IS NOT NULL
       UNION SELECT actor_user_id FROM audit_log WHERE tenant_id = $1 AND actor_user_id IS NOT NULL`,
      [tenantId],
    )
    const counts = {}
    for (const [label, sql] of PURGE) counts[label] = (await tx.query(sql, [tenantId])).rowCount
    // Staff logins of this workspace that belong to no other one: erased, then deleted when unreferenced.
    const ids = people.map((p) => p.id)
    await tx.query(`${ANONYMISE_USERS} AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id)`, [ids])
    await tx.query('DELETE FROM social_identities s USING users u WHERE s.user_id = u.id AND u.id = ANY($1::uuid[]) AND u.deleted_at IS NOT NULL', [ids])
    counts.logins = await pruneDeletedUsers(tx, ids)
    const {
      rows: [billing],
    } = await tx.query('SELECT count(*)::int AS n FROM subscription_checkouts WHERE tenant_id = $1', [tenantId])
    if (billing.n) {
      // Anonymous tombstone: only anchors the billing records kept for tax retention.
      await tx.query(
        `UPDATE tenants SET name = 'deleted', slug = 'deleted-' || substr(replace(id::text, '-', ''), 1, 24), logo = NULL, logo_version = 0,
                billing_phone = NULL, purged_at = now()
          WHERE id = $1`,
        [tenantId],
      )
    } else {
      await tx.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    }
    counts.billingRecordsKept = billing.n
    return { counts, cards, gifts }
  })
  if (!result) return null
  wallet?.forget({ loyalty: result.cards, gifts: result.gifts })
  return result.counts
}

/** Sweep (server.js, hourly): due purges, then billing records past retention and their tombstones. */
export async function runPurges(db, { wallet, now = new Date() } = {}) {
  const { rows } = await db.query('SELECT id FROM tenants WHERE purge_after <= $1 AND purged_at IS NULL ORDER BY purge_after LIMIT 50', [now])
  const out = { purged: 0, failed: 0, billingRecordsExpired: 0, tombstonesRemoved: 0 }
  for (const { id } of rows) {
    try {
      if (await purgeTenant(db, id, { wallet })) out.purged += 1
    } catch (err) {
      out.failed += 1
      console.warn(`[deletion] purge of ${id} failed, will retry: ${err.message}`)
    }
  }
  out.billingRecordsExpired = (
    await db.query(
      `DELETE FROM subscription_checkouts c USING tenants t
        WHERE c.tenant_id = t.id AND t.purged_at IS NOT NULL
          AND COALESCE(c.paid_at, c.created_at) < date_trunc('year', $1::timestamptz) - make_interval(years => $2)`,
      [now, BILLING_RETENTION_YEARS],
    )
  ).rowCount
  // A late billing webhook may have re-created a cache row on a tombstone; it goes with it.
  await db.query('DELETE FROM subscriptions s USING tenants t WHERE s.tenant_id = t.id AND t.purged_at IS NOT NULL')
  out.tombstonesRemoved = (
    await db.query('DELETE FROM tenants t WHERE t.purged_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subscription_checkouts c WHERE c.tenant_id = t.id)')
  ).rowCount
  return out
}

/** Erases one member at the store's request. Returns null when the member does not
    exist (or is already erased), otherwise { cards, forfeited }. */
export async function eraseMember(db, { tenantId, memberId, actorUserId, wallet }) {
  const result = await db.tx(async (tx) => {
    const {
      rows: [member],
    } = await tx.query('SELECT id FROM members WHERE id = $1 AND tenant_id = $2 AND erased_at IS NULL FOR UPDATE', [memberId, tenantId])
    if (!member) return null
    const { rows: cards } = await tx.query(
      'SELECT id, pass_version AS version, code FROM accounts WHERE member_id = $1 AND tenant_id = $2 ORDER BY id FOR UPDATE',
      [memberId, tenantId],
    )
    let forfeited = 0
    for (const card of cards) forfeited += await forfeitBalance(tx, { tenantId, accountId: card.id, actorUserId })
    // Device registrations (device id, push token) of every version of the member's cards.
    await tx.query(
      `DELETE FROM apple_registrations WHERE split_part(serial, '-v', 1) IN (SELECT 'acct-' || id FROM accounts WHERE member_id = $1 AND tenant_id = $2)`,
      [memberId, tenantId],
    )
    // Like a reissue: every identifier changes, so cards already handed out stop resolving.
    await tx.query(
      `UPDATE accounts SET
         code = upper(substr(md5(gen_random_uuid()::text), 1, 10)),
         pass_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
         apple_auth = replace(gen_random_uuid()::text, '-', ''),
         pass_version = pass_version + 1,
         updated_at = now()
       WHERE member_id = $1 AND tenant_id = $2`,
      [memberId, tenantId],
    )
    await tx.query(
      `UPDATE members SET phone = NULL, name = NULL, email = NULL, marketing_consent = false, consent_at = NULL, verified = false, erased_at = now()
        WHERE id = $1`,
      [memberId],
    )
    await tx.query("INSERT INTO audit_log (tenant_id, actor_user_id, action, target, data) VALUES ($1, $2, 'member.erased', $3, $4)", [
      tenantId,
      actorUserId,
      memberId,
      JSON.stringify({ cards: cards.length, forfeited }),
    ])
    return { cards, forfeited }
  })
  if (!result) return null
  wallet?.forget({ loyalty: result.cards })
  return { cards: result.cards.length, forfeited: result.forfeited }
}
