import { BACK_FIELDS, BARCODES, FRONT_FIELDS, LAYOUTS, MAX_LOCATIONS, MAX_NOTES, PROGRAM_TYPES, STAMP_SHAPES, validateProgramConfig } from '@mirqam-points/shared'
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../auth.js'
import { int } from '../db/index.js'
import { HttpError, id, parse } from '../http.js'
import { normalizeDesign } from '../wallet/model.js'
import { audit } from './util.js'

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const design = z
  .object({
    layout: z.enum(LAYOUTS),
    background: hex,
    foreground: hex,
    label: hex,
    stampColor: hex,
    stampShape: z.enum(STAMP_SHAPES),
    barcode: z.enum(BARCODES),
    front: z.array(z.enum(FRONT_FIELDS)).max(3),
    back: z.array(z.enum(BACK_FIELDS)).max(BACK_FIELDS.length),
    notes: z.array(z.object({ label: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(400) }).strict()).max(MAX_NOTES),
    rewardText: z.string().trim().max(140),
    // Branches: Google Maps links on the back; Apple Wallet "nearby" notices.
    locations: z
      .array(
        z
          .object({
            name: z.string().trim().max(40),
            latitude: z.number().min(-90).max(90).nullable().optional(),
            longitude: z.number().min(-180).max(180).nullable().optional(),
            mapsUrl: z.string().trim().max(500).url().optional().or(z.literal('')),
          })
          .strict(),
      )
      .max(MAX_LOCATIONS),
    nearby: z.boolean(),
    nearbyText: z.string().trim().max(100),
  })
  .partial()
  .strict()

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(PROGRAM_TYPES),
  config: z.record(z.string(), z.unknown()).default({}),
  design: design.default({}),
  selfEnroll: z.boolean().default(false),
})
const patchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  design: design.optional(),
  selfEnroll: z.boolean().optional(),
  status: z.enum(['active', 'archived']).optional(),
})

// draft → active → archived ⇄ active. Nothing returns to draft once members may hold balances.
const TRANSITIONS = { draft: ['active'], active: ['archived'], archived: ['active'] }

export function mapProgram(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    config: row.config,
    design: normalizeDesign(row.design),
    selfEnroll: row.self_enroll,
    members: row.members == null ? undefined : int(row.members),
    outstanding: row.outstanding == null ? undefined : int(row.outstanding),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function checkConfig(type, raw) {
  const result = validateProgramConfig(type, raw)
  if (!result.ok) throw new HttpError(400, result.error)
  return result.config
}

const LIST_SQL = `SELECT p.*, COUNT(a.id) AS members, COALESCE(SUM(a.balance), 0) AS outstanding
                    FROM programs p LEFT JOIN accounts a ON a.program_id = p.id
                   WHERE p.tenant_id = $1`

export default function programRoutes({ db, wallet }) {
  const r = Router()
  r.use(requireAuth)

  r.get('/', async (req, res) => {
    const { rows } = await db.query(`${LIST_SQL} GROUP BY p.id ORDER BY p.created_at DESC`, [req.auth.tenantId])
    res.json({ items: rows.map(mapProgram) })
  })

  r.post('/', requireRole('manager'), async (req, res) => {
    const body = parse(createBody, req.body)
    const config = checkConfig(body.type, body.config)
    const {
      rows: [row],
    } = await db.query('INSERT INTO programs (tenant_id, name, type, config, design, self_enroll) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', [
      req.auth.tenantId,
      body.name,
      body.type,
      JSON.stringify(config),
      JSON.stringify(body.design),
      body.selfEnroll,
    ])
    await audit(db, req, 'program.created', row.id, { name: body.name, type: body.type })
    res.status(201).json(mapProgram(row))
  })

  r.get('/:id', async (req, res) => {
    const programId = parse(id, req.params.id)
    const {
      rows: [row],
    } = await db.query(`${LIST_SQL} AND p.id = $2 GROUP BY p.id`, [req.auth.tenantId, programId])
    if (!row) throw new HttpError(404, 'program_not_found')
    res.json(mapProgram(row))
  })

  r.patch('/:id', requireRole('manager'), async (req, res) => {
    const programId = parse(id, req.params.id)
    const body = parse(patchBody, req.body)
    const updated = await db.tx(async (tx) => {
      const {
        rows: [current],
      } = await tx.query('SELECT * FROM programs WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [programId, req.auth.tenantId])
      if (!current) throw new HttpError(404, 'program_not_found')
      if (body.status && body.status !== current.status && !TRANSITIONS[current.status].includes(body.status)) {
        throw new HttpError(422, 'invalid_status_transition')
      }
      // Config changes apply to future earns only; posted history is immutable.
      const config = body.config ? checkConfig(current.type, { ...current.config, ...body.config }) : current.config
      const nextDesign = body.design ? { ...current.design, ...body.design } : current.design
      const {
        rows: [row],
      } = await tx.query(
        `UPDATE programs SET name = $3, config = $4, status = $5, design = $6, self_enroll = $7, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [
          programId,
          req.auth.tenantId,
          body.name ?? current.name,
          JSON.stringify(config),
          body.status ?? current.status,
          JSON.stringify(nextDesign),
          body.selfEnroll ?? current.self_enroll,
        ],
      )
      return row
    })
    await audit(db, req, 'program.updated', programId, body)
    // Anything printed on the pass changed: refresh every holder's pass.
    if (body.name || body.design || body.config) wallet.notifyProgram(programId)
    res.json(mapProgram(updated))
  })

  return r
}
