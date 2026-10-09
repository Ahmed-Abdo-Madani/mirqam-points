/* Public, unauthenticated wallet surfaces:
   - /api/wallet/apple/v1/*  Apple PassKit web service (device registration, pass refresh)
   - /api/public/pass/:token  loyalty pass page data + Apple/Google add links
   - /api/public/gift/:token  gift card page data + Apple/Google add links
   - /api/public/join/...     self-enrollment from a QR poster (new numbers only)
   Tokens in these URLs are bearer secrets (>=128 bits); responses never list other members. */
import { normalizePhone } from '@mirqam-points/shared'
import express, { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { UNIQUE_VIOLATION } from '../db/index.js'
import { HttpError, id, parse } from '../http.js'
import { safeEqual } from '../secrets.js'
import { parseSerial } from '../wallet/model.js'

// Apple's web service posts JSON outside the console's CSRF rules; it gets its own small parser.
const express_json = express.json({ limit: '8kb' })

const tokenParam = z.string().regex(/^[A-Za-z0-9_-]{24,128}$/)

function limiter(limit) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_q, res) => res.status(429).json({ error: 'rate_limited' }),
  })
}

function sendPkpass(res, buffer, name, lastModified) {
  res.setHeader('Content-Type', 'application/vnd.apple.pkpass')
  res.setHeader('Content-Disposition', `attachment; filename="${name}.pkpass"`)
  if (lastModified) res.setHeader('Last-Modified', lastModified.toUTCString())
  res.setHeader('Cache-Control', 'no-store')
  res.send(buffer)
}

export function appleWebService({ db, config, wallet }) {
  const r = Router()

  /* Resolves serial + "ApplePass <token>" to a pass model, or null when unknown/unauthorized. */
  async function authorize(req, serial) {
    const parsed = parseSerial(serial)
    const auth = /^ApplePass (.+)$/.exec(req.get('authorization') || '')
    if (!parsed || !auth || req.params.passTypeId !== config.apple.passTypeId) return null
    const found = parsed.kind === 'gift' ? await wallet.giftById(parsed.id) : await wallet.loyaltyById(parsed.id)
    if (!found) return null
    if (parsed.kind === 'loyalty' && found.model.version !== parsed.version) return null
    return safeEqual(found.model.authToken, auth[1]) ? found : null
  }

  r.post('/v1/devices/:deviceId/registrations/:passTypeId/:serial', express_json, async (req, res) => {
    if (!(await authorize(req, req.params.serial))) return res.sendStatus(401)
    const pushToken = String(req.body?.pushToken || '')
    if (!pushToken || pushToken.length > 200) return res.sendStatus(400)
    const {
      rows: [row],
    } = await db.query(
      `INSERT INTO apple_registrations (device_id, pass_type_id, serial, push_token) VALUES ($1, $2, $3, $4)
       ON CONFLICT (device_id, pass_type_id, serial) DO UPDATE SET push_token = EXCLUDED.push_token
       RETURNING (xmax = 0) AS inserted`,
      [req.params.deviceId.slice(0, 128), req.params.passTypeId, req.params.serial, pushToken],
    )
    res.sendStatus(row.inserted ? 201 : 200)
  })

  r.delete('/v1/devices/:deviceId/registrations/:passTypeId/:serial', async (req, res) => {
    if (!(await authorize(req, req.params.serial))) return res.sendStatus(401)
    await db.query('DELETE FROM apple_registrations WHERE device_id = $1 AND pass_type_id = $2 AND serial = $3', [
      req.params.deviceId,
      req.params.passTypeId,
      req.params.serial,
    ])
    res.sendStatus(200)
  })

  // Serials registered on a device that changed since the given tag (epoch ms).
  r.get('/v1/devices/:deviceId/registrations/:passTypeId', async (req, res) => {
    const since = Number(req.query.passesUpdatedSince) || 0
    const { rows } = await db.query('SELECT serial FROM apple_registrations WHERE device_id = $1 AND pass_type_id = $2', [
      req.params.deviceId,
      req.params.passTypeId,
    ])
    const changed = []
    let latest = since
    for (const { serial } of rows) {
      const parsed = parseSerial(serial)
      if (!parsed) continue
      const found = parsed.kind === 'gift' ? await wallet.giftById(parsed.id) : await wallet.loyaltyById(parsed.id)
      if (!found) continue
      const ts = found.model.updatedAt.getTime()
      if (ts > since) changed.push(serial)
      latest = Math.max(latest, ts)
    }
    if (!changed.length) return res.sendStatus(204)
    res.json({ serialNumbers: changed, lastUpdated: String(latest) })
  })

  r.get('/v1/passes/:passTypeId/:serial', async (req, res) => {
    const found = await authorize(req, req.params.serial)
    if (!found) return res.sendStatus(401)
    const since = req.get('if-modified-since')
    if (since && Math.floor(found.model.updatedAt.getTime() / 1000) <= Math.floor(new Date(since).getTime() / 1000)) return res.sendStatus(304)
    sendPkpass(res, wallet.pkpass(found.model), 'pass', found.model.updatedAt)
  })

  r.post('/v1/log', express_json, (req, res) => {
    for (const line of (req.body?.logs || []).slice(0, 20)) console.warn(`[wallet] apple log: ${String(line).slice(0, 300)}`)
    res.sendStatus(200)
  })

  return r
}

export function publicRoutes({ db, wallet }) {
  const r = Router()
  r.use(limiter(60))

  const walletLinks = (base) => ({ apple: wallet.status().apple ? `${base}/apple.pkpass` : null, google: wallet.status().google ? `${base}/google` : null })

  // ---- loyalty pass
  r.get('/pass/:token', async (req, res) => {
    const found = await wallet.loyaltyByToken(parse(tokenParam, req.params.token))
    if (!found) throw new HttpError(404, 'pass_not_found')
    const m = found.model
    res.json({
      merchant: m.merchant,
      programName: m.programName,
      type: m.type,
      balance: m.balance,
      stampsRequired: m.stampsRequired,
      memberName: m.memberName,
      code: m.code,
      barcode: m.barcode,
      design: m.design,
      wallet: walletLinks(`/api/public/pass/${req.params.token}`),
    })
  })

  r.get('/pass/:token/apple.pkpass', async (req, res) => {
    const found = await wallet.loyaltyByToken(parse(tokenParam, req.params.token))
    if (!found) throw new HttpError(404, 'pass_not_found')
    sendPkpass(res, wallet.pkpass(found.model), 'card', found.model.updatedAt)
  })

  r.get('/pass/:token/google', async (req, res) => {
    const found = await wallet.loyaltyByToken(parse(tokenParam, req.params.token))
    if (!found) throw new HttpError(404, 'pass_not_found')
    res.redirect(302, await wallet.googleUrl(found.model, found.slug))
  })

  // ---- gift card
  r.get('/gift/:token', async (req, res) => {
    const found = await wallet.giftByToken(parse(tokenParam, req.params.token))
    if (!found) throw new HttpError(404, 'gift_card_not_found')
    const m = found.model
    res.json({
      merchant: m.merchant,
      balanceMinor: m.balanceMinor,
      initialMinor: m.initialMinor,
      status: m.status,
      expiresAt: m.expiresAt,
      recipientName: m.recipientName,
      senderName: m.senderName,
      message: m.message,
      code: m.code,
      wallet: m.status === 'voided' ? { apple: null, google: null } : walletLinks(`/api/public/gift/${req.params.token}`),
    })
  })

  r.get('/gift/:token/apple.pkpass', async (req, res) => {
    const found = await wallet.giftByToken(parse(tokenParam, req.params.token))
    if (!found) throw new HttpError(404, 'gift_card_not_found')
    sendPkpass(res, wallet.pkpass(found.model), 'gift-card', found.model.updatedAt)
  })

  r.get('/gift/:token/google', async (req, res) => {
    const found = await wallet.giftByToken(parse(tokenParam, req.params.token))
    if (!found) throw new HttpError(404, 'gift_card_not_found')
    res.redirect(302, await wallet.googleUrl(found.model, found.slug))
  })

  // ---- self-enrollment
  async function joinableProgram(slug, programId) {
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.type, p.config, p.design, t.id AS tenant_id, t.name AS merchant
         FROM programs p JOIN tenants t ON t.id = p.tenant_id
        WHERE t.slug = $1 AND p.id = $2 AND p.status = 'active' AND p.self_enroll AND t.closed_at IS NULL`,
      [slug, programId],
    )
    if (!rows[0]) throw new HttpError(404, 'program_not_found')
    return rows[0]
  }

  r.get('/join/:slug/:programId', async (req, res) => {
    const p = await joinableProgram(req.params.slug, parse(id, req.params.programId))
    res.json({ merchant: p.merchant, programName: p.name, type: p.type, config: p.config, design: p.design })
  })

  const joinBody = z.object({
    phone: z.string().max(32),
    name: z.string().trim().min(1).max(120).optional(),
    locale: z.enum(['ar', 'en']).default('ar'),
    marketingConsent: z.boolean().default(false),
    acceptTerms: z.literal(true),
  })

  /* New numbers only. An existing member must get their card at the counter:
     handing a pass for an existing number to an anonymous visitor would let
     them spend someone else's points. Self-enrolled members start unverified. */
  r.post('/join/:slug/:programId', limiter(10), express_json_strict, async (req, res) => {
    const p = await joinableProgram(req.params.slug, parse(id, req.params.programId))
    const body = parse(joinBody, req.body)
    const phone = normalizePhone(body.phone)
    if (!phone) throw new HttpError(400, 'validation_failed', [{ path: 'phone', message: 'invalid_phone' }])
    try {
      const account = await db.tx(async (tx) => {
        const {
          rows: [member],
        } = await tx.query(
          `INSERT INTO members (tenant_id, phone, name, locale, marketing_consent, consent_at, verified)
           VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN now() END, false) RETURNING id`,
          [p.tenant_id, phone, body.name ?? null, body.locale, body.marketingConsent],
        )
        const {
          rows: [acct],
        } = await tx.query('INSERT INTO accounts (tenant_id, program_id, member_id) VALUES ($1, $2, $3) RETURNING pass_token', [p.tenant_id, p.id, member.id])
        return acct
      })
      res.status(201).json({ passToken: account.pass_token })
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) throw new HttpError(409, 'already_member')
      throw err
    }
  })

  return r
}

const express_json_strict = (req, _res, next) => {
  if (!req.is('application/json')) throw new HttpError(415, 'json_required')
  next()
}
