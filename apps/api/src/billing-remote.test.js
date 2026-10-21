import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRemoteBilling } from './billing-remote.js'
import { HttpError } from './http.js'
import { freshDb, seedTenant } from './testing.js'

let db
let calls
let billing
let tenantId
beforeAll(async () => {
  db = await freshDb()
  ;({ tenantId } = await seedTenant(db))
  const {
    rows: [u],
  } = await db.query("INSERT INTO users (email, password_hash, name) VALUES ('owner-remote@example.test', 'x', 'Owner') RETURNING id")
  await db.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenantId, u.id])
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null })
    return { ok: true, status: 200, json: async () => ({}) }
  }
  billing = createRemoteBilling({ db, config: { billingUrl: 'https://billing.example', billingApiKey: 'a'.repeat(64) }, HttpError, fetcher })
})
afterAll(async () => {
  await db?.close()
})

describe('owner contact sent to mirqam-billing', () => {
  it('syncAccount sends the saved WhatsApp number, and an explicit null once it is removed', async () => {
    calls = []
    await db.query("UPDATE tenants SET billing_phone = '+966551234567' WHERE id = $1", [tenantId])
    await billing.syncAccount(tenantId)
    expect(calls[0].url).toBe('https://billing.example/v1/accounts')
    expect(calls[0].body.account).toMatchObject({ ref: tenantId, email: 'owner-remote@example.test', phone: '+966551234567' })

    await db.query('UPDATE tenants SET billing_phone = NULL WHERE id = $1', [tenantId])
    await billing.syncAccount(tenantId)
    expect(calls[1].body.account.phone).toBe(null)
  })

  it('ordinary billing calls never send a null phone (so they cannot clear one set elsewhere)', async () => {
    calls = []
    await billing.validateCoupon(tenantId, 'monthly', 'ANY').catch(() => {})
    expect(calls.length).toBeGreaterThan(0)
    expect('phone' in (calls[0].body.account ?? {}) && calls[0].body.account.phone === null).toBe(false)
  })
})
