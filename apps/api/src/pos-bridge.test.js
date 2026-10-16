import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { expect, it } from 'vitest'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { freshDb } from './testing.js'

it('loyalty links use native owner sessions, survive SQL persistence and reject another workspace', async () => {
  const original = global.fetch,
    state = randomBytes(32).toString('base64url'),
    verifier = randomBytes(32).toString('base64url'),
    db = await freshDb()
  global.fetch = async (url, options) =>
    /^https:\/\/mirqam-api\.onrender\.com\/v1\/mirqam-apps\/(?:install-)?requests\//.test(String(url))
      ? new Response(
          JSON.stringify({
            app: 'loyalty',
            challenge: createHash('sha256').update(verifier).digest('base64url'),
            tenantRef: 'synthetic-pos',
            tenantName: 'Synthetic POS',
            subject: 'synthetic-pos:owner',
            email: 'new-pos@example.test',
            expiresAt: Date.now() + 600000,
          }),
        )
      : original(url, options)
  let app
  try {
    app = createApp({ db, config: loadConfig({ NODE_ENV: 'test', PUBLIC_URL: 'http://localhost:4310', AUTH_RATE_LIMIT: '1000' }) })
  } finally {
    global.fetch = original
  }
  const server = createServer((req, res) => {
    req.headers.host = 'localhost:4310'
    app(req, res)
  }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  const base = 'http://127.0.0.1:' + server.address().port
  let cookie = ''
  const call = (p, body) =>
    original(base + p, {
      method: body ? 'POST' : 'GET',
      headers: { host: 'localhost:4310', origin: 'http://localhost:4310', 'content-type': 'application/json', cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  try {
    let r = await call('/api/auth/register', {
      email: 'pos-owner@example.test',
      password: 'Local-test-only-9372',
      name: 'Synthetic owner',
      businessName: 'Synthetic Loyalty',
    })
    expect(r.status).toBe(201)
    cookie = r.headers.get('set-cookie').split(';')[0]
    const ownerCookie = cookie
    expect((await call('/api/pos/identity')).status).toBe(200)
    r = await call('/api/pos/authorize', { state, consent: true })
    expect(r.status).toBe(200)
    const code = new URL((await r.json()).returnUrl).searchParams.get('code')
    r = await call('/api/pos/exchange', { state, code, verifier })
    expect(r.status).toBe(200)
    const link = await r.json()
    expect((await db.query('SELECT data FROM pos_account_links WHERE key=$1', ['link:' + link.id])).rows[0].data.active).toBe(true)
    expect((await call('/api/pos/links/' + link.id + '/check')).status).toBe(200)
    r = await call('/api/auth/register', {
      email: 'pos-other@example.test',
      password: 'Local-test-only-9372',
      name: 'Other owner',
      businessName: 'Other workspace',
    })
    cookie = r.headers.get('set-cookie').split(';')[0]
    expect((await call('/api/pos/links/' + link.id + '/check')).status).toBe(403)
    cookie = ownerCookie
    expect((await call('/api/pos/revoke', { id: link.id, revoke: link.revoke })).status).toBe(200)
    expect((await call('/api/pos/links/' + link.id + '/check')).status).toBe(403)
    r = await call('/api/pos/install', { state, proof: verifier, email: 'forged@example.test' })
    expect(r.status).toBe(200)
    expect(r.headers.get('set-cookie')).toContain('HttpOnly')
    cookie = r.headers.get('set-cookie').split(';')[0]
    const created = (await db.query("SELECT * FROM users WHERE email='new-pos@example.test'")).rows[0]
    expect(created).toBeTruthy()
    expect((await db.query("SELECT * FROM users WHERE email='forged@example.test'")).rows.length).toBe(0)
    const provisioned = (await db.query('SELECT * FROM pos_provisioned_accounts WHERE subject=$1', ['synthetic-pos:owner'])).rows[0]
    expect(provisioned.user_id).toBe(created.id)
    const start = (await db.query('SELECT created_at FROM tenants WHERE id=$1', [provisioned.tenant_id])).rows[0].created_at.toISOString()
    expect((await call('/api/pos/install', { state, proof: verifier })).status).toBe(200)
    expect((await db.query('SELECT created_at FROM tenants WHERE id=$1', [provisioned.tenant_id])).rows[0].created_at.toISOString()).toBe(start)
    await db.query("UPDATE tenants SET created_at=now()-interval '90 days' WHERE id=$1", [provisioned.tenant_id])
    expect((await call('/api/programs', { name: 'Should fail', kind: 'points' })).status).toBe(402)
    expect((await call('/api/billing/state')).status).toBe(200)
  } finally {
    await new Promise((r) => server.close(r))
    await db.close()
  }
})
