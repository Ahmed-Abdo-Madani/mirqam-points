#!/usr/bin/env node
/* Runs the verify gate against a REAL Postgres server (embedded-postgres
   binaries, started on a free port in a temp dir) through node-postgres —
   the production driver. Use before deploying schema or query changes:
   node scripts/verify-pg.mjs */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = await new Promise((resolve) => {
  const s = createServer().listen(0, () => {
    const p = s.address().port
    s.close(() => resolve(p))
  })
})
const dir = mkdtempSync(join(tmpdir(), 'mp-pg-'))
// UTF8 explicitly: on Windows initdb otherwise inherits WIN1252, which cannot store Arabic.
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
})
let code = 1
try {
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('mirqam_points_test')
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/mirqam_points_test`
  console.log(`[verify-pg] Postgres on :${port}`)
  const run = spawnSync(process.execPath, ['scripts/verify.mjs', ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, TEST_DATABASE_URL: url, VERIFY_DATABASE_URL: url },
  })
  code = run.status ?? 1
} finally {
  await pg.stop().catch(() => {})
  rmSync(dir, { recursive: true, force: true })
}
process.exit(code)
