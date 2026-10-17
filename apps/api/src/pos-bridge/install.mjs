import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSession, hashPassword, requireAuth, sessionCookie, slugify } from '../auth.js'
import { installPosBridge } from './provider.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
export function installLoyaltyPosBridge({ app, db, config, billing }) {
  installPosBridge({
    app,
    authenticate: requireAuth,
    product: 'loyalty',
    loyaltyOperations: true,
    trialDays: config.trialDays,
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
    store: {
      async provision(proof) {
        return db.tx(async (tx) => {
          await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['pos-install:' + proof.subject])
          let row = (
            await tx.query('SELECT p.*,t.name,t.closed_at FROM pos_provisioned_accounts p JOIN tenants t ON t.id=p.tenant_id WHERE subject=$1', [proof.subject])
          ).rows[0]
          if (!row) {
            const email = proof.email.trim().toLowerCase()
            if ((await tx.query('SELECT id FROM users WHERE lower(email)=$1', [email])).rows.length)
              throw Object.assign(Error('account_exists'), { status: 409 })
            const pw = await hashPassword(randomBytes(48).toString('hex'))
            let user
            try {
              user = (
                await tx.query("INSERT INTO users(email,password_hash,name,locale) VALUES($1,$2,$3,'ar') RETURNING id", [
                  email,
                  pw,
                  proof.tenantName.slice(0, 120),
                ])
              ).rows[0]
            } catch (e) {
              if (e.code === '23505') throw Object.assign(Error('account_exists'), { status: 409 })
              throw e
            }
            const tenant = (
              await tx.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id,name', [proof.tenantName.slice(0, 120), slugify(proof.tenantName)])
            ).rows[0]
            await tx.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [tenant.id, user.id])
            await tx.query('INSERT INTO pos_provisioned_accounts(subject,tenant_id,user_id) VALUES($1,$2,$3)', [proof.subject, tenant.id, user.id])
            await tx.query("INSERT INTO audit_log(tenant_id,actor_user_id,action) VALUES($1,$2,'tenant.created')", [tenant.id, user.id])
            row = { tenant_id: tenant.id, user_id: user.id, name: tenant.name }
          }
          if (
            row.closed_at ||
            !(await tx.query("SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='owner'", [row.tenant_id, row.user_id])).rows.length
          )
            throw Object.assign(Error('owner_required'), { status: 403 })
          return { id: row.tenant_id, userId: row.user_id, name: row.name, canLink: true }
        })
      },
      async startSession(req, res, identity) {
        const token = await createSession(db, {
          userId: identity.userId,
          tenantId: identity.id,
          userAgent: req.get('user-agent'),
          ttlDays: config.sessionTtlDays,
        })
        res.setHeader('Set-Cookie', sessionCookie(token, { production: config.production, ttlDays: config.sessionTtlDays }))
        return {}
      },
      async access(identity) {
        const e = await billing.entitlement(identity.id)
        return { ...e, billingUrl: '/app/billing' }
      },

      async identity(req) {
        return { id: req.auth.tenantId, name: req.auth.tenant.name, canLink: req.auth.role === 'owner' }
      },
      async get(key) {
        return (await db.query('SELECT data FROM pos_account_links WHERE key=$1', [key])).rows[0]?.data
      },
      async put(key, value) {
        await db.query(
          'INSERT INTO pos_account_links(key,tenant_id,data) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET data=EXCLUDED.data WHERE pos_account_links.tenant_id=EXCLUDED.tenant_id',
          [key, value.identity.id, value],
        )
      },
      async take(key) {
        return (await db.query('DELETE FROM pos_account_links WHERE key=$1 RETURNING data', [key])).rows[0]?.data
      },
    },
  })
}
