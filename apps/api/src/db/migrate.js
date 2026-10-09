/* Forward-only SQL migrations from apps/api/migrations, each applied in its
   own transaction and recorded in schema_migrations. Files are never edited
   after they ship — add a new numbered file instead. */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations')

export async function migrate(db, { log = () => {} } = {}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const { rows } = await db.query('SELECT name FROM schema_migrations')
  const applied = new Set(rows.map((r) => r.name))
  const files = readdirSync(DIR)
    .filter((f) => /^\d{3}-[\w-]+\.sql$/.test(f))
    .sort()
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(DIR, file), 'utf8')
    await db.tx(async (tx) => {
      await tx.exec(sql)
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
    })
    log(`[db] applied ${file}`)
  }
}
