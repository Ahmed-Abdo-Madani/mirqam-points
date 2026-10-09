import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findByCode, issue, redeem, voidCard } from './giftcards.js'
import { normalizeCode, seal, unseal } from './secrets.js'
import { freshDb, seedTenant } from './testing.js'

const SECRET = 'test-secret'
let db
beforeAll(async () => {
  db = await freshDb()
})
afterAll(() => db.close())

let n = 0
const key = () => `gift-key-${++n}-${Math.random().toString(36).slice(2)}`

describe('secrets', () => {
  it('seals and unseals; tampering fails', () => {
    const s = seal('ABCD', SECRET)
    expect(unseal(s, SECRET)).toBe('ABCD')
    expect(() => unseal(s, 'other')).toThrow()
  })
  it('normalizes typed codes', () => {
    expect(normalizeCode('abcd-efgh ijkl-mnop')).toBe('ABCDEFGH1JK1MN0P')
  })
})

describe('gift cards', () => {
  it('issues, reveals code once per request, finds by code, redeems partially', async () => {
    const { tenantId } = await seedTenant(db)
    const k = key()
    const issued = await issue(db, { tenantId, amountMinor: 20000, idempotencyKey: k }, SECRET)
    expect(issued.code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/)
    expect(issued.card.balanceMinor).toBe(20000)
    const again = await issue(db, { tenantId, amountMinor: 20000, idempotencyKey: k }, SECRET)
    expect(again).toMatchObject({ replayed: true, code: issued.code })
    expect(again.card.id).toBe(issued.card.id)

    const found = await findByCode(db, tenantId, issued.code.toLowerCase())
    expect(found.id).toBe(issued.card.id)
    const r = await redeem(db, { tenantId, cardId: found.id, amountMinor: 7550, idempotencyKey: key() })
    expect(r.card.balanceMinor).toBe(12450)
    await expect(redeem(db, { tenantId, cardId: found.id, amountMinor: 12451, idempotencyKey: key() })).rejects.toMatchObject({ code: 'insufficient_balance' })
  })

  it('concurrent redemptions never overdraw', async () => {
    const { tenantId } = await seedTenant(db)
    const { card } = await issue(db, { tenantId, amountMinor: 10000, idempotencyKey: key() }, SECRET)
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => redeem(db, { tenantId, cardId: card.id, amountMinor: 3000, idempotencyKey: key() })),
    )
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(3)
    const { rows } = await db.query('SELECT balance_minor FROM gift_cards WHERE id = $1', [card.id])
    expect(Number(rows[0].balance_minor)).toBe(1000)
  })

  it('voided, frozen and expired cards cannot be spent', async () => {
    const { tenantId } = await seedTenant(db)
    const a = await issue(db, { tenantId, amountMinor: 5000, idempotencyKey: key() }, SECRET)
    await voidCard(db, { tenantId, cardId: a.card.id, idempotencyKey: key() })
    await expect(redeem(db, { tenantId, cardId: a.card.id, amountMinor: 1, idempotencyKey: key() })).rejects.toMatchObject({ code: 'gift_card_voided' })

    const b = await issue(db, { tenantId, amountMinor: 5000, idempotencyKey: key(), expiresAt: '2000-01-01' }, SECRET)
    await expect(redeem(db, { tenantId, cardId: b.card.id, amountMinor: 1, idempotencyKey: key() })).rejects.toMatchObject({ code: 'gift_card_expired' })

    const c = await issue(db, { tenantId, amountMinor: 5000, idempotencyKey: key() }, SECRET)
    await db.query("UPDATE gift_cards SET status = 'frozen' WHERE id = $1", [c.card.id])
    await expect(redeem(db, { tenantId, cardId: c.card.id, amountMinor: 1, idempotencyKey: key() })).rejects.toMatchObject({ code: 'gift_card_frozen' })
  })

  it('codes are tenant-scoped and history is append-only', async () => {
    const a = await seedTenant(db)
    const b = await seedTenant(db)
    const { code, card } = await issue(db, { tenantId: a.tenantId, amountMinor: 5000, idempotencyKey: key() }, SECRET)
    expect(await findByCode(db, b.tenantId, code)).toBeNull()
    await expect(redeem(db, { tenantId: b.tenantId, cardId: card.id, amountMinor: 1, idempotencyKey: key() })).rejects.toMatchObject({
      code: 'gift_card_not_found',
    })
    await expect(db.query('UPDATE gift_card_entries SET amount_minor = 1 WHERE gift_card_id = $1', [card.id])).rejects.toThrow(/append-only/)
  })

  it('refuses to issue without a secret key', async () => {
    const { tenantId } = await seedTenant(db)
    await expect(issue(db, { tenantId, amountMinor: 5000, idempotencyKey: key() }, '')).rejects.toMatchObject({ code: 'gift_cards_unavailable' })
  })
})
