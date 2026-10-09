import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adjust, earn, ensureAccount, LedgerError, reconcile, redeem, voidEntry } from './ledger.js'
import { freshDb, seedTenant } from './testing.js'

let db
beforeAll(async () => {
  db = await freshDb()
})
afterAll(() => db.close())

let n = 0
const key = () => `test-key-${++n}-${Math.random().toString(36).slice(2)}`

async function account() {
  const t = await seedTenant(db)
  const acct = await ensureAccount(db, t)
  return { ...t, accountId: acct.id }
}

describe('ledger', () => {
  it('earns and redeems, keeping balance and lifetime in step', async () => {
    const a = await account()
    const e1 = await earn(db, { ...a, points: 120, idempotencyKey: key(), purchaseMinor: 12000 })
    expect(e1).toMatchObject({ balance: 120, replayed: false, entry: { kind: 'earn', amount: 120, balanceAfter: 120, purchaseMinor: 12000 } })
    const r1 = await redeem(db, { ...a, points: 50, idempotencyKey: key() })
    expect(r1.balance).toBe(70)
    expect(r1.entry.amount).toBe(-50)
    const {
      rows: [acct],
    } = await db.query('SELECT balance, lifetime_earned FROM accounts WHERE id = $1', [a.accountId])
    expect(Number(acct.balance)).toBe(70)
    expect(Number(acct.lifetime_earned)).toBe(120)
  })

  it('refuses to overdraw', async () => {
    const a = await account()
    await earn(db, { ...a, points: 10, idempotencyKey: key() })
    await expect(redeem(db, { ...a, points: 11, idempotencyKey: key() })).rejects.toMatchObject({ code: 'insufficient_balance', status: 422 })
  })

  it('replays an idempotent request without double-posting', async () => {
    const a = await account()
    const k = key()
    const first = await earn(db, { ...a, points: 30, idempotencyKey: k })
    const again = await earn(db, { ...a, points: 30, idempotencyKey: k })
    expect(again.replayed).toBe(true)
    expect(again.entry.id).toBe(first.entry.id)
    expect(again.balance).toBe(30)
  })

  it('rejects a reused key carrying a different request', async () => {
    const a = await account()
    const k = key()
    await earn(db, { ...a, points: 30, idempotencyKey: k })
    await expect(earn(db, { ...a, points: 31, idempotencyKey: k })).rejects.toMatchObject({ code: 'idempotency_mismatch' })
    await expect(redeem(db, { ...a, points: 30, idempotencyKey: k })).rejects.toMatchObject({ code: 'idempotency_mismatch' })
  })

  it('serializes concurrent redeems so only the affordable ones succeed', async () => {
    const a = await account()
    await earn(db, { ...a, points: 100, idempotencyKey: key() })
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => redeem(db, { ...a, points: 30, idempotencyKey: key() })))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
    expect(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'insufficient_balance')).toBe(true)
    expect(await reconcile(db, { tenantId: a.tenantId })).toEqual([])
  })

  it('concurrent duplicates of one key post exactly once', async () => {
    const a = await account()
    const k = key()
    const results = await Promise.all(Array.from({ length: 4 }, () => earn(db, { ...a, points: 7, idempotencyKey: k })))
    expect(new Set(results.map((r) => r.entry.id)).size).toBe(1)
    expect(results.filter((r) => !r.replayed)).toHaveLength(1)
    const { rows } = await db.query('SELECT count(*)::int AS c FROM ledger_entries WHERE account_id = $1', [a.accountId])
    expect(rows[0].c).toBe(1)
  })

  it('voids an entry once, and adjusts lifetime for voided earns', async () => {
    const a = await account()
    const e = await earn(db, { ...a, points: 40, idempotencyKey: key() })
    const v = await voidEntry(db, { tenantId: a.tenantId, entryId: e.entry.id, idempotencyKey: key() })
    expect(v.balance).toBe(0)
    expect(v.entry).toMatchObject({ kind: 'void', amount: -40, reversesEntryId: e.entry.id })
    await expect(voidEntry(db, { tenantId: a.tenantId, entryId: e.entry.id, idempotencyKey: key() })).rejects.toMatchObject({ code: 'already_voided' })
    await expect(voidEntry(db, { tenantId: a.tenantId, entryId: v.entry.id, idempotencyKey: key() })).rejects.toMatchObject({ code: 'cannot_void_void' })
    const {
      rows: [acct],
    } = await db.query('SELECT lifetime_earned FROM accounts WHERE id = $1', [a.accountId])
    expect(Number(acct.lifetime_earned)).toBe(0)
  })

  it('will not void an earn whose points were already spent', async () => {
    const a = await account()
    const e = await earn(db, { ...a, points: 20, idempotencyKey: key() })
    await redeem(db, { ...a, points: 15, idempotencyKey: key() })
    await expect(voidEntry(db, { tenantId: a.tenantId, entryId: e.entry.id, idempotencyKey: key() })).rejects.toMatchObject({ code: 'insufficient_balance' })
  })

  it('voiding a redeem restores the points', async () => {
    const a = await account()
    await earn(db, { ...a, points: 20, idempotencyKey: key() })
    const r = await redeem(db, { ...a, points: 15, idempotencyKey: key() })
    const v = await voidEntry(db, { tenantId: a.tenantId, entryId: r.entry.id, idempotencyKey: key() })
    expect(v.balance).toBe(20)
  })

  it('adjust needs a reason and may go either way', async () => {
    const a = await account()
    await expect(adjust(db, { ...a, points: 5, idempotencyKey: key() })).rejects.toMatchObject({ code: 'note_required' })
    expect((await adjust(db, { ...a, points: 5, note: 'goodwill', idempotencyKey: key() })).balance).toBe(5)
    expect((await adjust(db, { ...a, points: -5, note: 'correction', idempotencyKey: key() })).balance).toBe(0)
  })

  it('validates amounts and keys', async () => {
    const a = await account()
    for (const points of [0, -1, 1.5, 10_000_001, Number.NaN]) {
      await expect(earn(db, { ...a, points, idempotencyKey: key() })).rejects.toBeInstanceOf(LedgerError)
    }
    await expect(earn(db, { ...a, points: 1, idempotencyKey: 'short' })).rejects.toMatchObject({ code: 'idempotency_key_required' })
  })

  it('cannot touch another tenant’s account', async () => {
    const a = await account()
    const b = await account()
    await expect(earn(db, { tenantId: b.tenantId, accountId: a.accountId, points: 1, idempotencyKey: key() })).rejects.toMatchObject({
      code: 'account_not_found',
    })
    const e = await earn(db, { ...a, points: 3, idempotencyKey: key() })
    await expect(voidEntry(db, { tenantId: b.tenantId, entryId: e.entry.id, idempotencyKey: key() })).rejects.toMatchObject({ code: 'entry_not_found' })
  })

  it('the schema rejects edits to history and cross-tenant rows', async () => {
    const a = await account()
    const b = await account()
    const e = await earn(db, { ...a, points: 3, idempotencyKey: key() })
    await expect(db.query('UPDATE ledger_entries SET amount = 999 WHERE id = $1', [e.entry.id])).rejects.toThrow(/append-only/)
    await expect(db.query('DELETE FROM ledger_entries WHERE id = $1', [e.entry.id])).rejects.toThrow(/append-only/)
    await expect(db.query('UPDATE accounts SET balance = -1 WHERE id = $1', [a.accountId])).rejects.toThrow()
    // An account linking tenant B to tenant A's member must violate the composite FK.
    await expect(
      db.query('INSERT INTO accounts (tenant_id, program_id, member_id) VALUES ($1, $2, $3)', [b.tenantId, b.programId, a.memberId]),
    ).rejects.toThrow()
  })

  it('reconcile reports drift between cache and ledger', async () => {
    const a = await account()
    await earn(db, { ...a, points: 9, idempotencyKey: key() })
    await db.query('UPDATE accounts SET balance = 8 WHERE id = $1', [a.accountId])
    expect(await reconcile(db, { tenantId: a.tenantId })).toEqual([{ accountId: a.accountId, tenantId: a.tenantId, balance: 8, ledgerBalance: 9 }])
  })
})
