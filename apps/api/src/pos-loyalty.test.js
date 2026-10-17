import { createHash, randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
import { adjust, ensureAccount, reconcile } from './ledger.js'
import { createPosLoyalty } from './pos-bridge/loyalty.mjs'
import { freshDb, seedTenant } from './testing.js'

it('POS uses one native balance: durable replay, concurrent sales, refund, tenant isolation and cutover import', async () => {
  const db = await freshDb(),
    s = await seedTenant(db),
    other = await seedTenant(db)
  const wallet = { notifyAccount: () => {} },
    service = createPosLoyalty({ db, billing: { entitlement: async () => ({ allowed: true }) }, wallet })
  const pos = 'synthetic-pos',
    phone = (await db.query('SELECT phone FROM members WHERE id=$1', [s.memberId])).rows[0].phone
  try {
    await service.run('configure', s.tenantId, pos, { programId: s.programId, pointsPerSar: 10 })
    const a = await ensureAccount(db, s)
    await adjust(db, { tenantId: s.tenantId, accountId: a.id, points: 100, idempotencyKey: 'seed-test-100', note: 'synthetic opening balance' })
    const body = { orderRef: 'sale-1', phone, programId: s.programId, points: 20, maxDiscountMinor: 10000, discountMinor: 200, purchaseMinor: 9800 }
    expect((await service.run('open', s.tenantId, pos, body)).discountMinor).toBe(200)
    expect((await service.run('balance', s.tenantId, pos, { phone })).balance).toBe(80)
    expect((await service.run('open', s.tenantId, pos, body)).replayed).toBe(true)
    await expect(service.run('open', s.tenantId, pos, { ...body, points: 21 })).rejects.toMatchObject({ code: 'idempotency_mismatch' })
    // Config changes after opening do not change earning on the saved invoice.
    await db.query('UPDATE programs SET config=$2 WHERE id=$1', [s.programId, { pointsPerUnit: 50, unitMinor: 100 }])
    expect((await service.run('settle', s.tenantId, pos, { orderRef: 'sale-1' })).earned).toBe(98)
    expect((await service.run('settle', s.tenantId, pos, { orderRef: 'sale-1' })).replayed).toBe(true)
    const restarted = createPosLoyalty({ db, billing: { entitlement: async () => ({ allowed: true }) }, wallet })
    expect((await restarted.run('balance', s.tenantId, pos, { phone })).balance).toBe(178)
    await restarted.run('reverse', s.tenantId, pos, { orderRef: 'sale-1' })
    expect((await service.run('balance', s.tenantId, pos, { phone })).balance).toBe(100)
    expect((await restarted.run('reverse', s.tenantId, pos, { orderRef: 'sale-1' })).replayed).toBe(true)
    await service.run('reverse', s.tenantId, pos, { orderRef: 'cancel-before-open' })
    await expect(service.run('open', s.tenantId, pos, { ...body, orderRef: 'cancel-before-open' })).rejects.toMatchObject({ code: 'pos_sale_reversed' })
    await expect(service.run('balance', other.tenantId, pos, { phone })).rejects.toMatchObject({ code: 'pos_loyalty_not_configured' })
    await expect(service.run('configure', other.tenantId, pos, { programId: other.programId, pointsPerSar: 10 })).rejects.toMatchObject({
      code: 'pos_link_conflict',
    })
    const imp = { sourceRef: 'legacy-account-1', phone, units: 35, type: 'points' }
    await service.run('import', s.tenantId, pos, imp)
    expect((await restarted.run('import', s.tenantId, pos, imp)).replayed).toBe(true)
    expect((await service.run('balance', s.tenantId, pos, { phone })).balance).toBe(135)
    await expect(service.run('import', s.tenantId, pos, { ...imp, units: 40 })).rejects.toMatchObject({ code: 'idempotency_mismatch' })
    expect(await reconcile(db, { tenantId: s.tenantId })).toEqual([])
    // Two competing cashiers cannot spend the same units.
    const results = await Promise.allSettled(
      ['cashier-A', 'cashier-B'].map((orderRef) => service.run('open', s.tenantId, pos, { ...body, orderRef, points: 100, discountMinor: 1000 })),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await service.run('balance', s.tenantId, pos, { phone })).balance).toBe(35)
  } finally {
    await db.close()
  }
})
it('POS service credential is separate from sessions and revocation stops it; expiry permits reversals only', async () => {
  const db = await freshDb(),
    s = await seedTenant(db),
    token = randomBytes(32).toString('base64url'),
    link = randomBytes(32).toString('base64url')
  let allowed = true
  const service = createPosLoyalty({ db, billing: { entitlement: async () => ({ allowed }) }, wallet: { notifyAccount() {} } })
  const data = { identity: { id: s.tenantId }, active: true, posTenant: 'pos-1', loyaltyAccessHash: createHash('sha256').update(token).digest('base64url') }
  try {
    await db.query('INSERT INTO pos_account_links(key,tenant_id,data) VALUES($1,$2,$3)', ['link:' + link, s.tenantId, data])
    const req = { body: { linkId: link }, params: { action: 'open' }, get: () => `Bearer ${token}` }
    expect((await service.authorize(req)).tenantId).toBe(s.tenantId)
    await expect(service.authorize({ ...req, get: () => `Bearer ${'x'.repeat(43)}` })).rejects.toMatchObject({ status: 403 })
    allowed = false
    await expect(service.authorize(req)).rejects.toMatchObject({ status: 402 })
    expect((await service.authorize({ ...req, params: { action: 'reverse' } })).tenantId).toBe(s.tenantId)
    await db.query('UPDATE pos_account_links SET data=$2 WHERE key=$1', ['link:' + link, { ...data, active: false }])
    await expect(service.authorize(req)).rejects.toMatchObject({ status: 403 })
  } finally {
    await db.close()
  }
})
