/* The customer pager page joins this workspace's Mirqam Loyalty program (stream S7).

   The owner picks, per pager branch, which active program the customer page offers (Pager → Setup →
   Branches). The choice is stored on the POS side with the branch's pager settings, so the customer page
   needs one read. The page posts the join to the POS API, which calls here server to server with the bridge
   key (Authorization: Bearer MIRQAM_POS_BRIDGE_KEY, the key the POS already uses for /api/pos/native/ensure).
   The browser never calls this server for it, so no CORS change and no key in a page.

   - POST /api/pos/pager/offer { loyaltyTenantId, programId }
       → { active, program? }   active = program active here and the workspace's Loyalty plan live
   - POST /api/pos/pager/join { loyaltyTenantId, programId, phone (E.164), name, locale, marketingConsent, acceptTerms }
       → 201 { status: 'joined', passUrl, wallet } | 200 { status: 'already_member' } | 404 | 402
     Same rules as the public self-join (routes/wallet.js): the member starts unverified, and a number that is
     already a member never gets a pass (that would hand someone else's points to whoever typed it).
   - Console: GET /api/pager/offers (programs the picker lists), PUT /api/pager/offers/:branchId { programId | null }. */
import { normalizePhone } from '@mirqam-points/shared'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { requireAuth, requireRole } from './auth.js'
import { UNIQUE_VIOLATION } from './db/index.js'
import { HttpError, id, parse } from './http.js'
import { safeEqual } from './secrets.js'

const joinBody = z.object({
  loyaltyTenantId: id,
  programId: id,
  phone: z.string().max(32),
  name: z.string().trim().min(1).max(120),
  locale: z.enum(['ar', 'en']).default('ar'),
  marketingConsent: z.boolean().default(false),
  acceptTerms: z.literal(true),
})
const offerBody = z.object({ loyaltyTenantId: id, programId: id })
const pickBody = z.object({ programId: id.nullable() })
const countryBody = z.object({ country: z.string().regex(/^[A-Z]{2}$/) })
const pairBody = z.object({
  phone: z
    .string()
    .regex(/^\+?\d{8,15}$/)
    .optional(),
})
const BRANCH = /^[A-Za-z0-9_-]{1,80}$/

export function createPagerOffer({ db, config, billing, wallet }) {
  /** The program, when it is this workspace's, active, and the workspace's Loyalty plan is live. */
  async function liveProgram(tenantId, programId) {
    const p = (
      await db.query(
        `SELECT p.id, p.name, p.type, p.config FROM programs p JOIN tenants t ON t.id = p.tenant_id
          WHERE p.tenant_id = $1 AND p.id = $2 AND p.status = 'active' AND t.closed_at IS NULL`,
        [tenantId, programId],
      )
    ).rows[0]
    if (!p) return null
    if (!(await billing.entitlement(tenantId)).allowed) return null
    return { id: p.id, name: p.name, type: p.type, config: p.config || {} }
  }

  async function check(body) {
    const { loyaltyTenantId, programId } = parse(offerBody, body)
    const program = await liveProgram(loyaltyTenantId, programId)
    return program ? { active: true, program } : { active: false }
  }

  async function join(body) {
    const b = parse(joinBody, body)
    const program = await liveProgram(b.loyaltyTenantId, b.programId)
    if (!program) {
      const exists = (await db.query("SELECT 1 FROM programs WHERE tenant_id=$1 AND id=$2 AND status='active'", [b.loyaltyTenantId, b.programId])).rows.length
      throw new HttpError(exists ? 402 : 404, exists ? 'loyalty_inactive' : 'program_not_found')
    }
    const phone = normalizePhone(b.phone)
    if (!phone) throw new HttpError(400, 'validation_failed', [{ path: 'phone', message: 'invalid_phone' }])
    let account
    try {
      account = await db.tx(async (tx) => {
        const {
          rows: [member],
        } = await tx.query(
          `INSERT INTO members (tenant_id, phone, name, locale, marketing_consent, consent_at, verified)
           VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN now() END, false) RETURNING id`,
          [b.loyaltyTenantId, phone, b.name, b.locale, b.marketingConsent],
        )
        const {
          rows: [acct],
        } = await tx.query('INSERT INTO accounts (tenant_id, program_id, member_id) VALUES ($1, $2, $3) RETURNING pass_token', [
          b.loyaltyTenantId,
          program.id,
          member.id,
        ])
        await tx.query("INSERT INTO audit_log (tenant_id, action, target, data) VALUES ($1, 'member.joined_from_pager', $2, $3)", [
          b.loyaltyTenantId,
          member.id,
          { programId: program.id },
        ])
        return acct
      })
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) return { status: 'already_member' }
      throw err
    }
    const base = (config.publicUrl || '').replace(/\/+$/, '')
    const w = wallet.status()
    return {
      status: 'joined',
      passUrl: `${base}/p/${account.pass_token}`,
      wallet: {
        apple: w.apple ? `${base}/api/public/pass/${account.pass_token}/apple.pkpass` : null,
        google: w.google ? `${base}/api/public/pass/${account.pass_token}/google` : null,
      },
    }
  }

  /** Programs the Setup picker lists: the workspace's active ones. */
  async function programs(tenantId) {
    const { rows } = await db.query("SELECT id, name, type FROM programs WHERE tenant_id=$1 AND status='active' ORDER BY created_at", [tenantId])
    return rows
  }

  /** Saves one branch's choice on the POS side (through the pager counter's bridge call). */
  async function pick(tenantId, branchId, body, counter) {
    if (!BRANCH.test(String(branchId))) throw new HttpError(404, 'not_found')
    const { programId } = parse(pickBody, body)
    let payload = { programId: null }
    if (programId) {
      const program = await liveProgram(tenantId, programId)
      if (!program) throw new HttpError(409, 'program_not_offerable')
      const c = program.config
      payload = {
        programId: program.id,
        name: program.name,
        type: program.type,
        ...(program.type === 'points' ? { pointsPerUnit: c.pointsPerUnit, unitMinor: c.unitMinor } : { stampsRequired: c.stampsRequired }),
      }
    }
    return counter.bridge(tenantId, 'PUT', `/branches/${encodeURIComponent(branchId)}/loyalty-offer`, payload)
  }

  return { check, join, programs, pick }
}

/** Bearer check for the POS's server-to-server calls (same key and rules as /api/pos/native/ensure). */
export function posBridgeGate(env = process.env) {
  const key = (env.MIRQAM_POS_BRIDGE_KEY || '').trim()
  const enabled = key.length >= 32 && !/\s/.test(key)
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (!enabled) return res.status(503).json({ error: 'bridge_disabled' })
    const got = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!safeEqual(got, key)) return res.status(401).json({ error: 'unauthorized' })
    next()
  }
}

export function installPagerOffer({ app, offer, env = process.env }) {
  const gate = posBridgeGate(env)
  app.post('/api/pos/pager/offer', gate, async (req, res) => res.json(await offer.check(req.body)))
  app.post('/api/pos/pager/join', gate, async (req, res) => {
    const result = await offer.join(req.body)
    res.status(result.status === 'joined' ? 201 : 200).json(result)
  })
}

/** /api/pager/offers: the branch picker (owner and manager), outside the loyalty paywall like the rest of /api/pager. */
export function pagerOfferRoutes({ offer, counter }) {
  const r = Router()
  const manage = [requireAuth, requireRole('manager')]
  r.get('/offers', ...manage, async (req, res) => res.json({ programs: await offer.programs(req.auth.tenantId) }))
  r.put('/offers/:branchId', ...manage, async (req, res) => {
    await counter.requireLive(req.auth.tenantId)
    res.json(await offer.pick(req.auth.tenantId, req.params.branchId, req.body, counter))
  })

  // The business's country: the customer page's phone forms default to it.
  r.put('/country', ...manage, async (req, res) => {
    const { country } = parse(countryBody, req.body)
    await counter.requireLive(req.auth.tenantId)
    res.json(await counter.bridge(req.auth.tenantId, 'PUT', '/settings', { country }))
  })

  // WhatsApp alerts from the business's own number (Plus): link with the bot's QR, state, unlink.
  r.get('/whatsapp', ...manage, async (req, res) => {
    await counter.requireLive(req.auth.tenantId)
    res.json(await counter.bridge(req.auth.tenantId, 'GET', '/whatsapp'))
  })
  r.post('/whatsapp/pair', ...manage, rateLimit({ windowMs: 60_000, limit: 10 }), async (req, res) => {
    const { phone } = parse(pairBody, req.body ?? {})
    await counter.requireLive(req.auth.tenantId)
    res.json(await counter.bridge(req.auth.tenantId, 'POST', '/whatsapp/pair', phone ? { phone } : {}))
  })
  r.post('/whatsapp/unlink', ...manage, async (req, res) => {
    await counter.requireLive(req.auth.tenantId)
    res.json(await counter.bridge(req.auth.tenantId, 'POST', '/whatsapp/unlink', {}))
  })
  return r
}
