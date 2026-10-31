/* Copy the Oregon database into this service's database (the Frankfurt move,
   RUNBOOK.md). Run it INSIDE the Frankfurt service (Render → mirqam-points-fra
   → Shell), where both connection strings are already in the environment —
   nobody has to handle them:

     SOURCE_DATABASE_URL  the Oregon database's EXTERNAL URL (pasted by the owner)
     DATABASE_URL         this service's own database (linked by render.yaml);
                          TARGET_DATABASE_URL overrides it (rehearsal into a scratch DB)

     node apps/api/src/db/copy-cli.js             copy into an EMPTY target
     node apps/api/src/db/copy-cli.js --replace   re-copy over a previous run (atomic)
     node apps/api/src/db/copy-cli.js --verify    compare only; writes nothing

   Exit 0 = copied and verified ("ALL TABLES COPIED AND VERIFIED") or, with
   --verify, identical ("SOURCE AND TARGET MATCH"). Refuses to touch a target
   whose service is already live unless --target-is-live is given too. */
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { CopyError, copyDatabase, verifyDatabase } from './copy.js'
import { migrate } from './migrate.js'

// External Render hosts need TLS (certificate verified; PGSSLNOVERIFY=1 opts out). Internal hosts do not offer it.
function sslFor(url) {
  const external = /sslmode=require/.test(url) || /\.render\.com(?::\d+)?\//.test(url) || process.env.PGSSL === '1'
  return external ? { rejectUnauthorized: process.env.PGSSLNOVERIFY !== '1' } : undefined
}

const describe = (url) => {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname}`
  } catch {
    return '(unparseable URL)'
  }
}

async function connect(url) {
  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) })
  client.on('error', () => {})
  await client.connect()
  return client
}

/** Single-connection adapter for migrate(). */
const asDb = (client) => ({
  query: (t, p) => client.query(t, p),
  exec: (t) => client.query(t),
  async tx(fn) {
    await client.query('BEGIN')
    try {
      const out = await fn({ query: (t, p) => client.query(t, p), exec: (t) => client.query(t) })
      await client.query('COMMIT')
      return out
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    }
  },
})

/** mode: 'copy' | 'replace' | 'verify'. Resolves to an exit code; never throws. */
export async function runCopy({ mode, env = process.env, allowLiveTarget = false, log = console.log }) {
  const sourceUrl = env.SOURCE_DATABASE_URL
  const targetUrl = env.TARGET_DATABASE_URL || env.DATABASE_URL
  if (!sourceUrl || !targetUrl) {
    log('SOURCE_DATABASE_URL and DATABASE_URL (or TARGET_DATABASE_URL) are required')
    return 2
  }
  if (sourceUrl === targetUrl) {
    log('source and target are the same database')
    return 2
  }
  const live = env.MIRQAM_REQUIRE_LIVE === '1' && env.MIRQAM_LIVE === '1' && !env.TARGET_DATABASE_URL
  if (mode !== 'verify' && live && !allowLiveTarget) {
    log('this service is LIVE (MIRQAM_LIVE=1): copying would overwrite production data. Refusing (pass --target-is-live to override).')
    return 2
  }
  log(`${mode}: source ${describe(sourceUrl)} -> target ${describe(targetUrl)}`)
  let source
  let target
  try {
    source = await connect(sourceUrl)
    target = await connect(targetUrl)
    if (mode === 'verify') {
      const problems = await verifyDatabase({ source, target, log })
      log(problems ? `${problems} difference(s) — source and target do NOT match` : 'SOURCE AND TARGET MATCH')
      return problems ? 1 : 0
    }
    // The target's schema comes from this release's own migrations.
    await migrate(asDb(target), { log })
    const { tables, rows } = await copyDatabase({ source, target, mode, log })
    log(`ALL TABLES COPIED AND VERIFIED (${tables} tables, ${rows} rows)`)
    return 0
  } catch (err) {
    log(`${mode} FAILED — the target is unchanged: ${err instanceof CopyError ? err.message : err.message || err}`)
    return 1
  } finally {
    await source?.end().catch(() => {})
    await target?.end().catch(() => {})
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = new Set(process.argv.slice(2))
  const mode = args.has('--verify') ? 'verify' : args.has('--replace') ? 'replace' : 'copy'
  process.exit(await runCopy({ mode, allowLiveTarget: args.has('--target-is-live') }))
}
