/* Campaigns: a merchant message delivered to customers as a wallet-pass
   notification (Apple: changed pass field with a change message; Google:
   TEXT_AND_NOTIFY message). Sending is immediate, immutable and idempotent. */
import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../auth.js'
import { int, UNIQUE_VIOLATION } from '../db/index.js'
import { HttpError, id, idempotencyKey, pageQuery, parse } from '../http.js'
import { audit } from './util.js'

// Google caps notifications per pass per day, so more sends than this would silently stop alerting.
export const DAILY_LIMIT = 3

const AUDIENCES = ['consented', 'all']
const createBody = z.object({
  programId: id,
  title: z.string().trim().min(1).max(40),
  body: z.string().trim().min(1).max(200),
  audience: z.enum(AUDIENCES).default('consented'),
})
const audienceQuery = z.object({ programId: id, audience: z.enum(AUDIENCES).default('consented') })

// Erased members have no consent and are never messaged.
const AUDIENCE_WHERE = { consented: 'AND m.marketing_consent AND m.erased_at IS NULL', all: 'AND m.erased_at IS NULL' }
const RECENT_SQL = "SELECT count(*) AS n FROM campaigns WHERE tenant_id = $1 AND program_id = $2 AND created_at > now() - interval '24 hours'"

export function mapCampaign(row) {
  return {
    id: row.id,
    programId: row.program_id,
    programName: row.program_name ?? null,
    title: row.title,
    body: row.body,
    audience: row.audience,
    recipients: int(row.recipients),
    status: row.status,
    createdBy: row.created_by_name ?? null,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  }
}

const SELECT = `SELECT c.*, p.name AS program_name, u.name AS created_by_name
                  FROM campaigns c JOIN programs p ON p.id = c.program_id LEFT JOIN users u ON u.id = c.created_by`

export default function campaignRoutes({ db, wallet }) {
  const r = Router()
  r.use(requireAuth, requireRole('manager'))

  async function activeProgram(tenantId, programId) {
    const {
      rows: [program],
    } = await db.query('SELECT id, status FROM programs WHERE id = $1 AND tenant_id = $2', [programId, tenantId])
    if (!program) throw new HttpError(404, 'program_not_found')
    if (program.status !== 'active') throw new HttpError(422, 'program_not_active')
  }

  // How many passes a send would reach right now, plus how many sends the program has left today.
  r.get('/audience', async (req, res) => {
    const q = parse(audienceQuery, req.query)
    const tenantId = req.auth.tenantId
    await activeProgram(tenantId, q.programId)
    const [
      {
        rows: [audience],
      },
      {
        rows: [recent],
      },
    ] = await Promise.all([
      db.query(
        `SELECT count(*) AS n FROM accounts a JOIN members m ON m.id = a.member_id
          WHERE a.tenant_id = $1 AND a.program_id = $2 ${AUDIENCE_WHERE[q.audience]}`,
        [tenantId, q.programId],
      ),
      db.query(RECENT_SQL, [tenantId, q.programId]),
    ])
    res.json({ recipients: int(audience.n), sendsLeft: Math.max(DAILY_LIMIT - int(recent.n), 0) })
  })

  r.get('/', async (req, res) => {
    const q = parse(pageQuery, req.query)
    const [{ rows }, { rows: count }] = await Promise.all([
      db.query(`${SELECT} WHERE c.tenant_id = $1 ORDER BY c.created_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`, [req.auth.tenantId]),
      db.query('SELECT count(*)::int AS total FROM campaigns WHERE tenant_id = $1', [req.auth.tenantId]),
    ])
    res.json({ items: rows.map(mapCampaign), total: count[0].total, limit: q.limit, offset: q.offset })
  })

  r.get('/:campaignId', async (req, res) => {
    const {
      rows: [row],
    } = await db.query(`${SELECT} WHERE c.id = $1 AND c.tenant_id = $2`, [parse(id, req.params.campaignId), req.auth.tenantId])
    if (!row) throw new HttpError(404, 'campaign_not_found')
    res.json(mapCampaign(row))
  })

  r.post('/', async (req, res) => {
    const body = parse(createBody, req.body)
    const key = idempotencyKey(req)
    const tenantId = req.auth.tenantId
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify([body.programId, body.title, body.body, body.audience]))
      .digest('hex')

    // A retry with the same key returns the original campaign instead of messaging customers twice.
    const {
      rows: [prior],
    } = await db.query(`${SELECT} WHERE c.tenant_id = $1 AND c.idempotency_key = $2`, [tenantId, key])
    if (prior) {
      if (prior.request_hash !== requestHash) throw new HttpError(409, 'idempotency_mismatch')
      return res.json({ campaign: mapCampaign(prior), replayed: true })
    }

    await activeProgram(tenantId, body.programId)
    const {
      rows: [recent],
    } = await db.query(RECENT_SQL, [tenantId, body.programId])
    if (int(recent.n) >= DAILY_LIMIT) throw new HttpError(429, 'campaign_rate_limited')

    let campaign
    try {
      campaign = await db.tx(async (tx) => {
        const {
          rows: [c],
        } = await tx.query(
          `INSERT INTO campaigns (tenant_id, program_id, title, body, audience, created_by, idempotency_key, request_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [tenantId, body.programId, body.title, body.body, body.audience, req.auth.userId, key, requestHash],
        )
        const { rows: accounts } = await tx.query(
          `INSERT INTO campaign_recipients (campaign_id, tenant_id, account_id)
           SELECT $1, a.tenant_id, a.id FROM accounts a JOIN members m ON m.id = a.member_id
            WHERE a.tenant_id = $2 AND a.program_id = $3 ${AUDIENCE_WHERE[body.audience]}
           RETURNING account_id`,
          [c.id, tenantId, body.programId],
        )
        if (!accounts.length) throw new HttpError(422, 'no_recipients')
        // Bumping updated_at is what tells Wallet the pass changed and makes it re-fetch.
        await tx.query('UPDATE accounts SET updated_at = now() WHERE id = ANY($1)', [accounts.map((a) => a.account_id)])
        const {
          rows: [done],
        } = await tx.query('UPDATE campaigns SET recipients = $2 WHERE id = $1 RETURNING *', [c.id, accounts.length])
        return done
      })
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) throw new HttpError(409, 'idempotency_mismatch')
      throw err
    }

    await audit(db, req, 'campaign.sent', campaign.id, { programId: body.programId, audience: body.audience, recipients: campaign.recipients })
    // Fan-out to Apple/Google runs in the background; the request never waits on them.
    wallet
      .sendCampaign(campaign)
      .catch((err) => console.warn(`[wallet] campaign ${campaign.id} failed: ${err.message}`))
      .finally(() => db.query("UPDATE campaigns SET status = 'sent', sent_at = now() WHERE id = $1", [campaign.id]).catch(() => {}))
    res.status(201).json({ campaign: mapCampaign(campaign), replayed: false })
  })

  return r
}
