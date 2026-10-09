import { normalizePhone } from '@mirqam-points/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../auth.js'
import { int, UNIQUE_VIOLATION } from '../db/index.js'
import { HttpError, id, pageQuery, parse } from '../http.js'
import { ensureAccount, mapEntry } from '../ledger.js'
import { LOYALTY_SQL, loyaltyModel } from '../wallet/model.js'
import { audit } from './util.js'

export const phoneField = z
  .string()
  .max(32)
  .transform((v, ctx) => {
    const phone = normalizePhone(v)
    if (!phone) ctx.addIssue({ code: 'custom', message: 'invalid_phone' })
    return phone ?? z.NEVER
  })

const createBody = z.object({
  phone: phoneField,
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  locale: z.enum(['ar', 'en']).default('ar'),
  marketingConsent: z.boolean().default(false),
})
const patchBody = createBody.omit({ phone: true }).partial()
const listQuery = pageQuery.extend({ q: z.string().trim().max(80).optional() })

export function mapMember(row) {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    email: row.email,
    locale: row.locale,
    marketingConsent: row.marketing_consent,
    consentAt: row.consent_at,
    verified: row.verified,
    createdAt: row.created_at,
    // Per-program balances: points and stamps are different units and are never summed together.
    balances: row.balances ?? undefined,
  }
}

export default function memberRoutes({ db, wallet }) {
  const r = Router()
  r.use(requireAuth)

  r.get('/', async (req, res) => {
    const { q, limit, offset } = parse(listQuery, req.query)
    // Phone-like queries search the normalized form; anything else searches the name.
    const phone = q ? normalizePhone(q) : null
    const digits = q?.replace(/\D/g, '')
    const where = ['m.tenant_id = $1']
    const params = [req.auth.tenantId]
    if (phone) {
      params.push(phone)
      where.push(`m.phone = $${params.length}`)
    } else if (q && digits.length >= 3) {
      params.push(`%${digits}%`)
      where.push(`m.phone LIKE $${params.length}`)
    } else if (q) {
      params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      where.push(`m.name ILIKE $${params.length}`)
    }
    const filter = where.join(' AND ')
    const [
      { rows },
      {
        rows: [count],
      },
    ] = await Promise.all([
      db.query(
        `SELECT m.*,
                COALESCE((SELECT json_agg(json_build_object('programId', p.id, 'name', p.name, 'type', p.type, 'balance', a.balance) ORDER BY p.created_at)
                            FROM accounts a JOIN programs p ON p.id = a.program_id
                           WHERE a.member_id = m.id), '[]'::json) AS balances
           FROM members m WHERE ${filter} ORDER BY m.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      db.query(`SELECT count(*)::int AS total FROM members m WHERE ${filter}`, params),
    ])
    res.json({ items: rows.map(mapMember), total: count.total, limit, offset })
  })

  r.post('/', requireRole('manager', 'cashier'), async (req, res) => {
    const body = parse(createBody, req.body)
    try {
      const {
        rows: [row],
      } = await db.query(
        `INSERT INTO members (tenant_id, phone, name, email, locale, marketing_consent, consent_at)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 THEN now() END) RETURNING *`,
        [req.auth.tenantId, body.phone, body.name ?? null, body.email ?? null, body.locale, body.marketingConsent],
      )
      res.status(201).json(mapMember(row))
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err
      const {
        rows: [existing],
      } = await db.query('SELECT id FROM members WHERE tenant_id = $1 AND phone = $2', [req.auth.tenantId, body.phone])
      res.status(409).json({ error: 'member_exists', memberId: existing?.id })
    }
  })

  /* By phone (typed) or by card code (scanned from a wallet pass: "MP:XXXXXXXXXX"). */
  r.get('/lookup', async (req, res) => {
    if (req.query.code) {
      const code = String(req.query.code).trim().replace(/^MP:/i, '').toUpperCase()
      if (!/^[0-9A-Z]{6,16}$/.test(code)) throw new HttpError(404, 'member_not_found')
      const {
        rows: [row],
      } = await db.query(
        'SELECT m.*, a.program_id AS matched_program_id FROM accounts a JOIN members m ON m.id = a.member_id WHERE a.tenant_id = $1 AND a.code = $2',
        [req.auth.tenantId, code],
      )
      if (!row) throw new HttpError(404, 'member_not_found')
      return res.json({ ...mapMember(row), matchedProgramId: row.matched_program_id })
    }
    const { phone } = parse(z.object({ phone: phoneField }), req.query)
    const {
      rows: [row],
    } = await db.query('SELECT * FROM members WHERE tenant_id = $1 AND phone = $2', [req.auth.tenantId, phone])
    if (!row) throw new HttpError(404, 'member_not_found')
    res.json(mapMember(row))
  })

  r.get('/:id', async (req, res) => {
    const memberId = parse(id, req.params.id)
    const {
      rows: [row],
    } = await db.query('SELECT * FROM members WHERE id = $1 AND tenant_id = $2', [memberId, req.auth.tenantId])
    if (!row) throw new HttpError(404, 'member_not_found')
    const [{ rows: accounts }, { rows: entries }] = await Promise.all([
      db.query(
        `SELECT a.id, a.balance, a.lifetime_earned, a.created_at, a.code, a.pass_token, a.pass_version,
                p.id AS program_id, p.name, p.type, p.status, p.config
           FROM accounts a JOIN programs p ON p.id = a.program_id
          WHERE a.member_id = $1 AND a.tenant_id = $2 ORDER BY a.created_at`,
        [memberId, req.auth.tenantId],
      ),
      db.query(
        `SELECT e.*, a.program_id, (SELECT 1 FROM ledger_entries v WHERE v.reverses_entry_id = e.id) IS NOT NULL AS voided
           FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
          WHERE a.member_id = $1 AND e.tenant_id = $2 ORDER BY e.created_at DESC LIMIT 50`,
        [memberId, req.auth.tenantId],
      ),
    ])
    res.json({
      ...mapMember(row),
      accounts: accounts.map((a) => ({
        id: a.id,
        balance: int(a.balance),
        lifetimeEarned: int(a.lifetime_earned),
        createdAt: a.created_at,
        code: a.code,
        passPath: `/p/${a.pass_token}`,
        passVersion: a.pass_version,
        program: { id: a.program_id, name: a.name, type: a.type, status: a.status, config: a.config },
      })),
      entries: entries.map((e) => ({ ...mapEntry(e), programId: e.program_id, voided: e.voided })),
    })
  })

  /* Open an account (and so a wallet card) for a member in a program. */
  r.post('/:id/accounts', requireRole('manager', 'cashier'), async (req, res) => {
    const memberId = parse(id, req.params.id)
    const { programId } = parse(z.object({ programId: id }), req.body)
    const {
      rows: [program],
    } = await db.query("SELECT id FROM programs WHERE id = $1 AND tenant_id = $2 AND status = 'active'", [programId, req.auth.tenantId])
    if (!program) throw new HttpError(422, 'program_not_active')
    const {
      rows: [member],
    } = await db.query('SELECT id FROM members WHERE id = $1 AND tenant_id = $2', [memberId, req.auth.tenantId])
    if (!member) throw new HttpError(404, 'member_not_found')
    const account = await ensureAccount(db, { tenantId: req.auth.tenantId, programId, memberId })
    res.status(201).json({ id: account.id, code: account.code, passPath: `/p/${account.pass_token}` })
  })

  /* Reissue: every identifier on the card changes. Passes already installed
     (possibly on the wrong person's phone) stop resolving at the counter and
     are retired in both wallets. Also marks the member verified. */
  r.post('/:id/accounts/:accountId/reissue', requireRole('manager'), async (req, res) => {
    const memberId = parse(id, req.params.id)
    const accountId = parse(id, req.params.accountId)
    const {
      rows: [old],
    } = await db.query(`${LOYALTY_SQL} WHERE a.id = $1 AND a.member_id = $2 AND a.tenant_id = $3`, [accountId, memberId, req.auth.tenantId])
    if (!old) throw new HttpError(404, 'account_not_found')
    const {
      rows: [account],
    } = await db.query(
      `UPDATE accounts SET
         code = upper(substr(md5(gen_random_uuid()::text), 1, 10)),
         pass_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
         apple_auth = replace(gen_random_uuid()::text, '-', ''),
         pass_version = pass_version + 1,
         updated_at = now()
       WHERE id = $1 RETURNING code, pass_token, pass_version`,
      [accountId],
    )
    await db.query('UPDATE members SET verified = true WHERE id = $1', [memberId])
    wallet.retire(loyaltyModel(old, ''))
    await audit(db, req, 'account.reissued', accountId)
    res.json({ id: accountId, code: account.code, passPath: `/p/${account.pass_token}`, passVersion: account.pass_version })
  })

  r.patch('/:id', requireRole('manager'), async (req, res) => {
    const memberId = parse(id, req.params.id)
    const body = parse(patchBody, req.body)
    const {
      rows: [row],
    } = await db.query(
      `UPDATE members SET
         name = COALESCE($3, name), email = COALESCE($4, email), locale = COALESCE($5, locale),
         marketing_consent = COALESCE($6, marketing_consent),
         consent_at = CASE WHEN $6 IS TRUE AND NOT marketing_consent THEN now()
                           WHEN $6 IS FALSE THEN NULL ELSE consent_at END
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [memberId, req.auth.tenantId, body.name ?? null, body.email ?? null, body.locale ?? null, body.marketingConsent ?? null],
    )
    if (!row) throw new HttpError(404, 'member_not_found')
    await audit(db, req, 'member.updated', memberId, Object.keys(body))
    res.json(mapMember(row))
  })

  return r
}
