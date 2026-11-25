/* Go-live guard of the region move (MIGRATION.md, RUNBOOK.md "Move to Frankfurt").

   A service declared with MIRQAM_REQUIRE_LIVE=1 (mirqam-points-fra) starts the
   app only once MIRQAM_LIVE=1. Setting that flag before the data copy would put
   an EMPTY database in production: merchants would sign in to nothing, the POS
   would see zero balances, and new writes would diverge from Oregon. So on such
   a service the app also needs loyalty data in its database, or an explicit
   MIRQAM_MIGRATION_COMPLETE=1 from the operator (for a deliberately new
   database). Otherwise the process stays in standby and logs why.

   Services without MIRQAM_REQUIRE_LIVE (Oregon `mirqam-points`, local dev, the
   verify gate) never run this check. The check only reads: it runs before the
   migrations, so a refused start leaves the database exactly as it was. */

const TABLES = ['tenants', 'ledger_entries']

/** Whether the go-live check applies to this process (see runtime-mode.js). */
export function requiresLoyaltyData(env = process.env) {
  return env.MIRQAM_REQUIRE_LIVE === '1' && env.MIRQAM_MIGRATION_COMPLETE !== '1'
}

/** True when the database holds at least one workspace or ledger entry. Read-only. */
export async function hasLoyaltyData(db) {
  for (const table of TABLES) {
    const { rows } = await db.query('SELECT to_regclass($1) IS NOT NULL AS present', [table])
    if (!rows[0].present) continue
    const found = await db.query(`SELECT EXISTS (SELECT 1 FROM ${table}) AS found`)
    if (found.rows[0].found) return true
  }
  return false
}

export const EMPTY_DATABASE_REASON =
  'MIRQAM_LIVE=1 refused: the database has no loyalty data (no workspace, no ledger entry) and MIRQAM_MIGRATION_COMPLETE is not set. ' +
  'Copy the data first (MIGRATION.md), or set MIRQAM_MIGRATION_COMPLETE=1 if this database is meant to start empty. Staying in standby.'
