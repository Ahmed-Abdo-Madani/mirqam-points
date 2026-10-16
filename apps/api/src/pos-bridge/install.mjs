import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireAuth } from '../auth.js'
import { installPosBridge } from './provider.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
export function installLoyaltyPosBridge({ app, db }) {
  installPosBridge({
    app,
    authenticate: requireAuth,
    product: 'loyalty',
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
