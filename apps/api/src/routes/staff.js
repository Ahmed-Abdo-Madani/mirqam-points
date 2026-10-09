import { Router } from 'express'
import { z } from 'zod'
import { hashPassword, ROLES, requireRole } from '../auth.js'
import { UNIQUE_VIOLATION } from '../db/index.js'
import { HttpError, id, parse } from '../http.js'
import { audit } from './util.js'

/* Owner-managed staff. v1 sets an initial password the owner hands over;
   email invitations replace this once transactional email is wired. */
const createBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(120),
  role: z.enum(ROLES.filter((r) => r !== 'owner')),
  password: z.string().min(8).max(200),
})
const patchBody = z.object({ role: z.enum(ROLES) })

const mapStaff = (r) => ({ id: r.id, email: r.email, name: r.name, role: r.role, joinedAt: r.created_at })

export default function staffRoutes({ db }) {
  const r = Router()
  r.use(requireRole('manager'))

  r.get('/', async (req, res) => {
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1 ORDER BY m.created_at`,
      [req.auth.tenantId],
    )
    res.json({ items: rows.map(mapStaff) })
  })

  r.post('/', requireRole(), async (req, res) => {
    const body = parse(createBody, req.body)
    const passwordHash = await hashPassword(body.password)
    try {
      const row = await db.tx(async (tx) => {
        const {
          rows: [user],
        } = await tx.query('INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name', [
          body.email,
          passwordHash,
          body.name,
        ])
        const {
          rows: [m],
        } = await tx.query('INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3) RETURNING role, created_at', [
          req.auth.tenantId,
          user.id,
          body.role,
        ])
        return { ...user, ...m }
      })
      await audit(db, req, 'staff.added', row.id, { role: body.role })
      res.status(201).json(mapStaff(row))
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) throw new HttpError(409, 'email_taken')
      throw err
    }
  })

  r.patch('/:userId', requireRole(), async (req, res) => {
    const userId = parse(id, req.params.userId)
    const { role } = parse(patchBody, req.body)
    if (userId === req.auth.userId) throw new HttpError(422, 'cannot_change_own_role')
    const {
      rows: [row],
    } = await db.query(
      `UPDATE memberships SET role = $3 WHERE tenant_id = $1 AND user_id = $2
       RETURNING user_id AS id, role, created_at`,
      [req.auth.tenantId, userId, role],
    )
    if (!row) throw new HttpError(404, 'staff_not_found')
    await audit(db, req, 'staff.role_changed', userId, { role })
    res.json({ id: row.id, role: row.role })
  })

  r.delete('/:userId', requireRole(), async (req, res) => {
    const userId = parse(id, req.params.userId)
    if (userId === req.auth.userId) throw new HttpError(422, 'cannot_remove_self')
    const removed = await db.tx(async (tx) => {
      const { rowCount } = await tx.query('DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2', [req.auth.tenantId, userId])
      // Sign the removed person out of this workspace immediately.
      await tx.query('DELETE FROM sessions WHERE tenant_id = $1 AND user_id = $2', [req.auth.tenantId, userId])
      return rowCount
    })
    if (!removed) throw new HttpError(404, 'staff_not_found')
    await audit(db, req, 'staff.removed', userId)
    res.json({ ok: true })
  })

  return r
}
