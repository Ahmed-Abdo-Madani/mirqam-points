import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { installPosBridge } from './provider.mjs'

const random = () => randomBytes(32).toString('base64url')
const digest = (s) => createHash('sha256').update(s).digest('base64url')
test('account bridge: native auth, consent, PKCE, replay, isolation, expiry, revocation and frame assets', async (t) => {
  const rows = new Map(),
    state = random(),
    verifier = random(),
    app = express(),
    root = path.dirname(fileURLToPath(import.meta.url))
  const posRequest = { app: 'bot', challenge: digest(verifier), tenantRef: 'pos-A', tenantName: 'Synthetic POS', expiresAt: Date.now() + 600000 }
  app.use(express.json())
  installPosBridge({
    app,
    product: 'bot',
    home: '/app',
    login: '/login',
    register: '/register',
    assets: {
      script: path.join(root, 'bridge.js'),
      style: path.join(root, 'bridge.css'),
      html: path.join(root, 'bridge.html'),
      font: path.join(root, 'font.otf'),
      logo: path.join(root, 'logo.svg'),
    },
    authenticate: (req, res, next) => (req.get('x-test-user') ? next() : res.status(401).json({ error: 'unauthenticated' })),
    store: {
      identity: async (req) => ({ id: req.get('x-test-user'), name: 'Synthetic account', canLink: req.get('x-test-role') !== 'staff' }),
      get: async (k) => structuredClone(rows.get(k)),
      put: async (k, v) => rows.set(k, structuredClone(v)),
      take: async (k) => {
        const v = rows.get(k)
        rows.delete(k)
        return structuredClone(v)
      },
    },
    fetcher: async () => new Response(JSON.stringify(posRequest), { status: 200 }),
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  t.after(() => new Promise((r) => server.close(r)))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = (url, body, extra = {}) =>
    fetch(base + url, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...extra },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  const owner = { 'x-test-user': 'account-A' }
  assert.equal((await call('/api/pos/identity')).status, 401)
  assert.equal((await call('/pos/connect')).status, 200)
  assert.equal((await call('/pos/bridge.js')).status, 200)
  assert.equal((await call('/pos/font.otf')).status, 200)
  assert.equal((await call('/api/pos/authorize', { state, consent: true }, { ...owner, origin: 'https://evil.test' })).status, 403)
  assert.equal((await call('/api/pos/authorize', { state, consent: false }, owner)).status, 400)
  assert.equal((await call('/api/pos/authorize', { state, consent: true }, { ...owner, 'x-test-role': 'staff' })).status, 403)
  let r = await call('/api/pos/authorize', { state, consent: true }, owner)
  assert.equal(r.status, 200)
  const url = new URL((await r.json()).returnUrl),
    code = url.searchParams.get('code')
  assert.equal(url.origin, 'https://pos.mirqam.sa')
  assert.equal((await call('/api/pos/exchange', { state, code, verifier: random() })).status, 401)
  assert.equal((await call('/api/pos/exchange', { state: random(), code, verifier })).status, 401)
  r = await call('/api/pos/exchange', { state, code, verifier })
  assert.equal(r.status, 200)
  const link = await r.json()
  assert.ok(link.id && link.revoke)
  assert.ok(!JSON.stringify([...rows.values()]).includes(link.revoke))
  assert.equal((await call('/api/pos/exchange', { state, code, verifier })).status, 401)
  assert.equal((await call('/api/pos/links/' + link.id + '/check', null, { 'x-test-user': 'account-B' })).status, 403)
  assert.equal((await call('/api/pos/links/' + link.id + '/check', null, owner)).status, 200)
  assert.equal((await call('/api/pos/revoke', { id: link.id, revoke: random() })).status, 401)
  assert.equal((await call('/api/pos/revoke', { id: link.id, revoke: link.revoke })).status, 200)
  assert.equal((await call('/api/pos/links/' + link.id + '/check', null, owner)).status, 403)
  posRequest.expiresAt = Date.now() - 1
  assert.equal((await call('/api/pos/authorize', { state, consent: true }, owner)).status, 400)
})
