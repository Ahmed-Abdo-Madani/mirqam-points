import { request as httpRequest } from 'node:http'
import express from 'express'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createSession, loadSession } from './auth.js'
import { installHqAdmin } from './hq-admin.js'
import { errorHandler } from './http.js'
import { freshDb, seedTenant } from './testing.js'

let db, server, base, admin, customer, adminCookie, customerCookie
let grant,
  accepted = false
const code = 'a'.repeat(64)
beforeAll(async () => {
  db = await freshDb()
  admin = await seedTenant(db)
  customer = await seedTenant(db)
  for (const [label, t] of [
    ['admin', admin],
    ['customer', customer],
  ]) {
    const {
      rows: [u],
    } = await db.query('INSERT INTO users(email,password_hash,name) VALUES($1,$2,$3) RETURNING id', [label + '@example.test', 'not-a-login-hash', label])
    t.userId = u.id
    await db.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [t.tenantId, u.id])
  }
  await db.query('INSERT INTO hq_admin_access(tenant_id,user_id,enabled,bridge_key) VALUES($1,$2,true,$3)', [admin.tenantId, admin.userId, 'b'.repeat(64)])
  customerCookie = 'mp_session=' + (await createSession(db, { userId: customer.userId, tenantId: customer.tenantId, ttlDays: 1 }))
  grant = { userId: admin.userId, audience: 'https://loyalty.mirqam.sa', role: 'superadmin' }
  const app = express()
  app.use(express.json(), loadSession(db))
  installHqAdmin(app, {
    db,
    config: { production: true },
    wallet: { status: () => ({ apple: false, google: false }) },
    request: async (url, opts) => {
      expect(url).toBe('https://mirqam.sa/m/ad0ed94a6a279f02a1295ae283efa07d2c18/bridge/consume')
      expect(opts.headers.Authorization).toBe('Bearer ' + 'b'.repeat(64))
      expect(opts.redirect).toBe('error')
      expect(JSON.parse(opts.body)).toEqual({ platform: 'loyalty', code })
      if (accepted) return { ok: false }
      accepted = grant.role === 'superadmin'
      return { ok: true, json: async () => grant }
    },
  })
  app.use(errorHandler)
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = 'http://127.0.0.1:' + server.address().port
})
afterAll(async () => {
  await new Promise((r) => server.close(r))
  await db.close()
})
const entry = (origin = 'https://loyalty.mirqam.sa') =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      base + '/api/hq-entry',
      { method: 'POST', headers: { host: 'loyalty.mirqam.sa', origin, 'content-type': 'application/json' } },
      (res) => {
        let body = ''
        res.on('data', (d) => (body += d))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: {
              get: (key) => {
                const v = res.headers[key]
                return Array.isArray(v) ? v[0] : v
              },
            },
            json: async () => JSON.parse(body),
          }),
        )
      },
    )
    req.on('error', reject)
    req.end(JSON.stringify({ code }))
  })
test('anonymous and ordinary tenant owners cannot read global administration', async () => {
  expect((await fetch(base + '/api/hq-admin')).status).toBe(401)
  expect((await fetch(base + '/api/hq-admin', { headers: { cookie: customerCookie } })).status).toBe(403)
})
test('foreign origins and mismatched grant roles fail without creating a session', async () => {
  expect((await entry('https://example.test')).status).toBe(403)
  grant.role = 'owner'
  expect((await entry()).status).toBe(403)
  grant.role = 'superadmin'
  const {
    rows: [r],
  } = await db.query('SELECT count(*)::int AS count FROM sessions WHERE user_id=$1', [admin.userId])
  expect(r.count).toBe(0)
})
test('valid single-use handoff creates a secure native session and redacted overview', async () => {
  const r = await entry()
  expect(r.status).toBe(200)
  const c = r.headers.get('set-cookie')
  expect(c).toContain('HttpOnly')
  expect(c).toContain('Secure')
  expect(c).toContain('SameSite=Lax')
  adminCookie = c.split(';')[0]
  const result = await fetch(base + '/api/hq-admin', { headers: { cookie: adminCookie } })
  expect(result.status).toBe(200)
  expect(result.headers.get('cache-control')).toBe('no-store')
  const body = await result.json()
  expect(body.tenants.map((t) => t.id)).toEqual([customer.tenantId])
  expect(body.tenants[0].members).toBe(1)
  expect(body.paid.amount).toBe('0')
  expect(JSON.stringify(body)).not.toMatch(/bridge_key|password_hash|token_hash/)
  expect((await entry()).status).toBe(401)
})
test('disabling the dedicated grant revokes HQ access without altering tenant owners', async () => {
  await db.query('UPDATE hq_admin_access SET enabled=false WHERE user_id=$1', [admin.userId])
  expect((await fetch(base + '/api/hq-admin', { headers: { cookie: adminCookie } })).status).toBe(403)
  const {
    rows: [m],
  } = await db.query('SELECT role FROM memberships WHERE user_id=$1 AND tenant_id=$2', [customer.userId, customer.tenantId])
  expect(m.role).toBe('owner')
  expect((await entry()).status).toBe(403)
})
