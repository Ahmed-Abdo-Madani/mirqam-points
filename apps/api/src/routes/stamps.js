/* Custom stamp artwork per program: a small PNG drawn on the wallet card's
   stamp strip when the card design uses the 'custom' stamp shape. */
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../auth.js'
import { HttpError, id, parse } from '../http.js'
import { decodePng } from '../wallet/strip.js'
import { audit } from './util.js'

const MAX_STAMP_BYTES = 64_000
const body = z.object({ png: z.string().max(90_000) }).strict()

export default function stampRoutes({ db, wallet }) {
  const r = Router()
  r.use(requireAuth)

  async function program(req) {
    const programId = parse(id, req.params.id)
    const { rows } = await db.query('SELECT id FROM programs WHERE id = $1 AND tenant_id = $2', [programId, req.auth.tenantId])
    if (!rows[0]) throw new HttpError(404, 'program_not_found')
    return programId
  }

  r.get('/:id', async (req, res) => {
    const programId = await program(req)
    const { rows } = await db.query('SELECT png FROM program_stamps WHERE program_id = $1 AND tenant_id = $2', [programId, req.auth.tenantId])
    res.json({ png: rows[0] ? `data:image/png;base64,${Buffer.from(rows[0].png).toString('base64')}` : null })
  })

  r.put('/:id', requireRole('manager'), async (req, res) => {
    const programId = await program(req)
    const { png } = parse(body, req.body)
    const buf = Buffer.from(png.replace(/^data:image\/png;base64,/, ''), 'base64')
    if (buf.length > MAX_STAMP_BYTES) throw new HttpError(413, 'stamp_too_large')
    const img = decodePng(buf)
    if (!img || img.width < 32 || img.height < 32 || img.width > 512 || img.height > 512) throw new HttpError(422, 'invalid_stamp')
    await db.query(
      'INSERT INTO program_stamps (program_id, tenant_id, png) VALUES ($1, $2, $3) ON CONFLICT (program_id) DO UPDATE SET png = EXCLUDED.png, updated_at = now()',
      [programId, req.auth.tenantId, buf],
    )
    await audit(db, req, 'program.stamp_set', programId, { bytes: buf.length })
    wallet.notifyProgram(programId)
    res.json({ png: `data:image/png;base64,${buf.toString('base64')}` })
  })

  r.delete('/:id', requireRole('manager'), async (req, res) => {
    const programId = await program(req)
    await db.query('DELETE FROM program_stamps WHERE program_id = $1 AND tenant_id = $2', [programId, req.auth.tenantId])
    await audit(db, req, 'program.stamp_removed', programId)
    wallet.notifyProgram(programId)
    res.json({ png: null })
  })

  return r
}
