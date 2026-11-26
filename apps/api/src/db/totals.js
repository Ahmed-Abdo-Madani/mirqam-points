/* Human-readable totals of the loyalty data, printed by `copy-cli.js --verify`
   for both databases from the same read-only snapshot as the table checksums
   (MIGRATION.md, "verify row counts and balances"). Informational: the
   checksums decide whether source and target match; these lines let a person
   sign the move off at a glance. Points and stamps are different units, so
   balances are reported per program type and never summed; gift cards in
   halalas. Read-only. */

const COUNTED = ['tenants', 'members', 'programs', 'accounts', 'ledger_entries', 'gift_cards', 'gift_card_entries']

const text = (v) => String(v ?? 0)

/** Totals of `db` (anything with query()), or null when it has no loyalty schema yet. */
export async function loyaltyTotals(db) {
  const { rows } = await db.query("SELECT to_regclass('tenants') IS NOT NULL AS present")
  if (!rows[0].present) return null
  const counts = {}
  for (const table of COUNTED) counts[table] = text((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n)
  const byType = await db.query(
    `SELECT p.type, count(*) AS accounts, coalesce(sum(a.balance), 0) AS balance, coalesce(sum(a.lifetime_earned), 0) AS lifetime
       FROM accounts a JOIN programs p ON p.id = a.program_id
      GROUP BY p.type ORDER BY p.type`,
  )
  const balances = {}
  for (const r of byType.rows) balances[r.type] = { accounts: text(r.accounts), balance: text(r.balance), lifetimeEarned: text(r.lifetime) }
  const gift = await db.query('SELECT coalesce(sum(balance_minor), 0) AS halalas FROM gift_cards')
  // The ledger is the source of truth; accounts.balance is its cache.
  const drift = await db.query(
    `SELECT count(*) AS n FROM (
       SELECT a.id FROM accounts a LEFT JOIN ledger_entries l ON l.account_id = a.id
        GROUP BY a.id, a.balance HAVING a.balance <> coalesce(sum(l.amount), 0)) d`,
  )
  return { counts, balances, giftCardHalalas: text(gift.rows[0].halalas), accountsOffLedger: text(drift.rows[0].n) }
}

/** One line per side, e.g. `totals source: tenants 3, ... | points: 12 accounts, balance 450, earned 900 | ...`. */
export function formatTotals(side, totals) {
  if (!totals) return `totals ${side}: no loyalty schema`
  const counts = Object.entries(totals.counts)
    .map(([table, n]) => `${table} ${n}`)
    .join(', ')
  const balances = Object.entries(totals.balances).map(([type, b]) => `${type}: ${b.accounts} accounts, balance ${b.balance}, earned ${b.lifetimeEarned}`)
  return [`totals ${side}: ${counts}`, ...balances, `gift cards: ${totals.giftCardHalalas} halalas`, `accounts off ledger: ${totals.accountsOffLedger}`].join(
    ' | ',
  )
}
