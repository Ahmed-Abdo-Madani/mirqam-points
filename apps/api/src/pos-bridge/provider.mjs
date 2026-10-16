import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import rateLimit from 'express-rate-limit'
import { bridgeCopy } from './copy.mjs'

const digest = (s) => createHash('sha256').update(String(s)).digest('base64url')
const random = () => randomBytes(32).toString('base64url')
const valid = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s)
const failure = (status, message) => Object.assign(new Error(message), { status })
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
export const POS_ORIGIN = 'https://pos.mirqam.sa'
export const POS_API = 'https://mirqam-api.onrender.com/v1/mirqam-apps'
/** Existing accounts require native owner consent. New trials use a short-lived
 * POS owner proof; native adapters create their own session and billing state.
 * No native session credential is ever returned to POS. */
export function installPosBridge({
  app,
  store,
  authenticate,
  product,
  home,
  login,
  register,
  tokenKey = '',
  assets,
  trialDays = 0,
  fetcher = fetch,
  posApi = POS_API,
  posOrigin = POS_ORIGIN,
}) {
  const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((e) => (e.status ? res.status(e.status).json({ error: e.message }) : next(e)))
  const ownOrigin = (req, res, next) => {
    const origin = req.get('origin')
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'origin_denied' })
    next()
  }
  const config = {
    product,
    home,
    login,
    register,
    tokenKey,
    posOrigin,
    copy: bridgeCopy,
    installReady: Boolean(store.provision && store.startSession),
    trialDays,
  }
  app.get('/pos/font.otf', (_req, res) => res.type('font/otf').sendFile(assets.font))
  app.get('/pos/logo.svg', (_req, res) => res.type('svg').sendFile(assets.logo))
  app.get('/pos/bridge.js', (_req, res) => res.type('js').sendFile(assets.script))
  app.get('/pos/bridge.css', (_req, res) => res.type('css').sendFile(assets.style))
  app.get(['/pos/connect', '/pos/embedded', '/pos/install'], (_req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    res.sendFile(assets.html)
  })
  app.get('/pos/config', (_req, res) => res.set('Cache-Control', 'no-store').json(config))
  const installing = new Set()
  app.post(
    '/api/pos/install',
    ownOrigin,
    rateLimit({ windowMs: 900000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }),
    wrap(async (req, res) => {
      const { state, proof } = req.body ?? {}
      if (!valid(state) || !valid(proof) || !config.installReady) throw failure(400, 'invalid_request')
      if (installing.has(state)) throw failure(409, 'install_busy')
      installing.add(state)
      try {
        // The proof is issued only after a POS owner confirms installation. Resolve
        // identity from the fixed POS server, never from browser-supplied email/IDs.
        const r = await fetcher(`${posApi}/install-requests/${state}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app: product, proof }),
          signal: AbortSignal.timeout(8000),
          redirect: 'error',
        })
        if (!r.ok) throw failure(400, 'expired_request')
        const request = await r.json()
        if (
          request.app !== product ||
          !valid(request.challenge) ||
          request.expiresAt <= Date.now() ||
          typeof request.subject !== 'string' ||
          request.subject.length > 240 ||
          typeof request.email !== 'string' ||
          request.email.length > 254 ||
          !/^\S+@\S+\.\S+$/.test(request.email)
        )
          throw failure(400, 'invalid_request')
        const identity = await store.provision(request)
        if (!identity?.canLink) throw failure(403, 'owner_required')
        const code = random()
        await store.put(`code:${digest(code)}`, {
          state,
          challenge: request.challenge,
          posTenant: request.tenantRef,
          identity: { id: identity.id, name: identity.name },
          expiresAt: Date.now() + 120000,
        })
        const session = await store.startSession(req, res, identity)
        res
          .set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
          .json({ ...session, returnUrl: `${posOrigin}/marketplace/callback?app=${product}&state=${state}&code=${code}` })
      } finally {
        installing.delete(state)
      }
    }),
  )
  app.get(
    '/api/pos/identity',
    authenticate,
    wrap(async (req, res) => res.json(await store.identity(req))),
  )
  app.get(
    '/api/pos/requests/:state',
    authenticate,
    wrap(async (req, res) => {
      if (!valid(req.params.state)) throw failure(400, 'invalid_request')
      const r = await fetcher(`${posApi}/requests/${req.params.state}?app=${product}`, { signal: AbortSignal.timeout(8000), redirect: 'error' })
      if (!r.ok) throw failure(400, 'expired_request')
      const data = await r.json()
      if (data.app !== product || !valid(data.challenge) || data.expiresAt <= Date.now()) throw failure(400, 'invalid_request')
      res.json({ state: req.params.state, tenantName: data.tenantName, expiresAt: data.expiresAt })
    }),
  )
  app.post(
    '/api/pos/authorize',
    ownOrigin,
    authenticate,
    wrap(async (req, res) => {
      const state = req.body?.state
      if (!valid(state) || req.body?.consent !== true) throw failure(400, 'consent_required')
      const identity = await store.identity(req)
      if (!identity.canLink) throw failure(403, 'owner_required')
      const r = await fetcher(`${posApi}/requests/${state}?app=${product}`, { signal: AbortSignal.timeout(8000), redirect: 'error' })
      if (!r.ok) throw failure(400, 'expired_request')
      const request = await r.json()
      if (request.app !== product || !valid(request.challenge) || request.expiresAt <= Date.now()) throw failure(400, 'invalid_request')
      const code = random()
      await store.put(`code:${digest(code)}`, {
        state,
        challenge: request.challenge,
        posTenant: request.tenantRef,
        identity: { id: identity.id, name: identity.name },
        expiresAt: Date.now() + 120000,
      })
      res.json({ returnUrl: `${posOrigin}/marketplace/callback?app=${product}&state=${state}&code=${code}` })
    }),
  )
  // These backchannel operations carry unguessable, purpose-specific credentials;
  // browser session cookies never authorize them. CORS is intentionally absent.
  app.post(
    '/api/pos/exchange',
    wrap(async (req, res) => {
      const { code, verifier, state } = req.body ?? {}
      if (!valid(code) || !valid(verifier) || !valid(state)) throw failure(400, 'invalid_request')
      const key = `code:${digest(code)}`,
        old = await store.get(key)
      if (!old || old.expiresAt <= Date.now() || old.state !== state || !safeEqual(old.challenge, digest(verifier))) throw failure(401, 'invalid_code')
      const record = await store.take(key)
      if (!record || record.expiresAt <= Date.now() || record.state !== state || !safeEqual(record.challenge, digest(verifier)))
        throw failure(401, 'invalid_code')
      const id = random(),
        revoke = random()
      await store.put(`link:${id}`, {
        id,
        identity: record.identity,
        posTenant: record.posTenant,
        revokeHash: digest(revoke),
        createdAt: Date.now(),
        active: true,
      })
      res.json({ id, accountName: record.identity.name, accountRef: record.identity.id, revoke, embeddedUrl: `/pos/embedded?link=${id}` })
    }),
  )
  app.post(
    '/api/pos/revoke',
    wrap(async (req, res) => {
      const { id, revoke } = req.body ?? {}
      if (!valid(id) || !valid(revoke)) throw failure(401, 'invalid_request')
      const old = await store.get(`link:${id}`)
      if (!old || !safeEqual(old.revokeHash, digest(revoke))) throw failure(401, 'invalid_request')
      await store.put(`link:${id}`, { ...old, active: false, revokedAt: Date.now() })
      res.json({ ok: true })
    }),
  )
  app.get(
    '/api/pos/links/:id/check',
    authenticate,
    wrap(async (req, res) => {
      const identity = await store.identity(req)
      const id = req.params.id
      if (!valid(id)) throw failure(400, 'invalid_request')
      const record = await store.get(`link:${id}`)
      if (!record?.active || String(record.identity.id) !== String(identity.id) || !identity.canLink) throw failure(403, 'wrong_account')
      const access = store.access ? await store.access(identity) : null
      res.json({ ok: true, home: access?.allowed === false ? access.billingUrl : home, accountName: identity.name, access })
    }),
  )
}
