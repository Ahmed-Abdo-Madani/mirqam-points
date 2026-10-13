import { afterAll, beforeAll, expect, it } from 'vitest'
import { hashPassword } from './auth.js'
import { socialResolver } from './social-login.js'
import { freshDb } from './testing.js'

let db, resolve
beforeAll(async () => {
  db = await freshDb()
  resolve = socialResolver(db)
})
afterAll(() => db.close())
const identity = (email, subject = email, provider = 'google') => ({ provider, subject, email, name: 'صاحب المنشأة', emailVerified: true })
it('same verified email and both providers resolve one user and one workspace, including concurrent callbacks', async () => {
  const id = identity('same@gmail.com'),
    first = await resolve(id)
  const results = await Promise.all([resolve(id), resolve(identity(id.email, 'github-1', 'github'))])
  for (const r of results) expect(r).toEqual(first)
  expect((await db.query('SELECT count(*)::int AS n FROM users WHERE email=$1', [id.email])).rows[0].n).toBe(1)
  expect((await db.query('SELECT count(*)::int AS n FROM memberships WHERE user_id=$1', [first.userId])).rows[0].n).toBe(1)
})
it('existing password account requires proof once, then keeps its ID, role and tenant', async () => {
  const email = 'legacy@gmail.com',
    passwordHash = await hashPassword('existing-password')
  const {
    rows: [tenant],
  } = await db.query("INSERT INTO tenants(name,slug) VALUES('Original','original-social') RETURNING id")
  const {
    rows: [user],
  } = await db.query("INSERT INTO users(email,password_hash,name) VALUES($1,$2,'Legacy') RETURNING id", [email, passwordHash])
  await db.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'cashier')", [tenant.id, user.id])
  expect(await resolve(identity(email))).toEqual({ needsProof: true })
  await expect(resolve(identity(email), 'wrong')).rejects.toMatchObject({ code: 'social_password' })
  const result = await resolve(identity(email), 'existing-password')
  expect(result).toEqual({ userId: user.id, tenantId: tenant.id })
  expect(await resolve(identity(email))).toEqual(result)
  expect((await db.query('SELECT role FROM memberships WHERE user_id=$1', [user.id])).rows[0].role).toBe('cashier')
  expect((await db.query('SELECT password_hash FROM users WHERE id=$1', [user.id])).rows[0].password_hash).toBe(passwordHash)
})
it('changed provider email cannot transfer identity onto another existing account', async () => {
  const one = await resolve(identity('one@gmail.com', 'subject-one'))
  await resolve(identity('two@gmail.com', 'subject-two'))
  await expect(resolve(identity('two@gmail.com', 'subject-one'))).rejects.toMatchObject({ code: 'social_conflict' })
  expect(await resolve(identity('new-email@gmail.com', 'subject-one'))).toEqual(one)
})
it('closed workspace blocks social login and does not create a replacement', async () => {
  const ident = identity('closed@gmail.com'),
    u = await resolve(ident)
  await db.query('UPDATE tenants SET closed_at=now() WHERE id=$1', [u.tenantId])
  await expect(resolve(ident)).rejects.toMatchObject({ code: 'social_denied' })
  expect((await db.query('SELECT count(*)::int AS n FROM users WHERE email=$1', [ident.email])).rows[0].n).toBe(1)
})
it('account deletion accepts explicit fresh social confirmation, rejects stale or password sessions and isolates tenants', async () => {
  const { createSession } = await import('./auth.js')
  const { createApp } = await import('./app.js')
  const { loadConfig } = await import('./config.js')
  const target = await resolve(identity('delete-social@gmail.com'))
  const other = await resolve(identity('keep-social@gmail.com'))
  const config = loadConfig({ NODE_ENV: 'test', AUTH_RATE_LIMIT: '100' })
  const server = createApp({ db, config }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  const origin = 'http://127.0.0.1:' + server.address().port
  const request = async (token, body) =>
    fetch(origin + '/api/auth/delete-account', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'mp_session=' + token },
      body: JSON.stringify(body),
    })
  try {
    const passwordSession = await createSession(db, { ...target, ttlDays: 1 })
    const forged = await request(passwordSession, { socialConfirmation: true, socialAuthenticatedAt: new Date().toISOString() })
    expect(forged.status).toBe(401)
    expect((await forged.json()).error).toBe('social_reauth_required')
    const socialSession = await createSession(db, { ...target, ttlDays: 1, socialAuthenticated: true })
    expect((await request(socialSession, {})).status).toBe(401)
    await db.query("UPDATE sessions SET social_authenticated_at=now()-interval '6 minutes' WHERE user_id=$1", [target.userId])
    expect((await request(socialSession, { socialConfirmation: true })).status).toBe(401)
    const fresh = await createSession(db, { ...target, ttlDays: 1, socialAuthenticated: true })
    expect((await request(fresh, { socialConfirmation: true })).status).toBe(200)
    expect((await db.query('SELECT id FROM users WHERE id=$1', [target.userId])).rowCount).toBe(0)
    expect((await db.query('SELECT id FROM users WHERE id=$1', [other.userId])).rowCount).toBe(1)
    expect((await db.query('SELECT closed_at FROM tenants WHERE id=$1', [target.tenantId])).rows[0].closed_at).toBeTruthy()
    expect((await db.query('SELECT closed_at FROM tenants WHERE id=$1', [other.tenantId])).rows[0].closed_at).toBeNull()
  } finally {
    await new Promise((r) => server.close(r))
  }
})
