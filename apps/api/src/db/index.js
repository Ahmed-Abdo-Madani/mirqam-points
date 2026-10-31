/* One small adapter over two engines with identical SQL:
   - postgres://…   → node-postgres pool (production on Render)
   - pglite://<dir> → PGlite persisted to a local folder (development)
   - memory://      → PGlite in memory (tests and the verify gate)
   PGlite is real Postgres compiled to WASM, so constraints, triggers and
   row locks behave the same as production — no mock database.
   readOnly: every session refuses writes (default_transaction_read_only) —
   the write freeze of the Frankfurt move (runtime-mode.js). */

const READ_ONLY = 'SET default_transaction_read_only = on'

/** The same URL with every session started read only (startup `options`, kept with any already there). */
export function readOnlyUrl(url) {
  const u = new URL(url)
  const options = u.searchParams.get('options')
  u.searchParams.set('options', `${options ? `${options} ` : ''}-c default_transaction_read_only=on`)
  return u.toString()
}

export async function openDb(url, { readOnly = false } = {}) {
  if (/^postgres(ql)?:\/\//.test(url)) return openPg(url, readOnly)
  if (url === 'memory://' || url.startsWith('pglite://')) return openPglite(url, readOnly)
  throw new Error(`Unsupported DATABASE_URL scheme: ${url.split(':')[0]}`)
}

async function openPglite(url, readOnly) {
  const { PGlite } = await import('@electric-sql/pglite')
  const dataDir = url === 'memory://' ? undefined : url.slice('pglite://'.length)
  if (dataDir) {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dataDir, { recursive: true })
  }
  const lite = new PGlite(dataDir)
  await lite.waitReady
  if (readOnly) await lite.exec(READ_ONLY)
  const wrap = (q) => ({
    query: (text, params) => q.query(text, params),
    exec: (text) => q.exec(text),
  })
  return {
    kind: 'pglite',
    ...wrap(lite),
    tx: (fn) => lite.transaction((t) => fn(wrap(t))),
    close: () => lite.close(),
  }
}

async function openPg(url, readOnly) {
  const { default: pg } = await import('pg')
  const ssl = /sslmode=require/.test(url) || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined
  const pool = new pg.Pool({ connectionString: readOnly ? readOnlyUrl(url) : url, ssl, max: Number(process.env.PG_POOL_MAX || 10) })
  pool.on('error', (err) => console.error('[db] idle client error', err.message))
  // Arabic names and copy must round-trip: refuse to run on a non-UTF8 database.
  const { rows } = await pool.query('SHOW server_encoding')
  if (rows[0].server_encoding !== 'UTF8') {
    await pool.end()
    throw new Error(`Database encoding is ${rows[0].server_encoding}; UTF8 is required`)
  }
  return {
    kind: 'postgres',
    query: (text, params) => pool.query(text, params),
    exec: (text) => pool.query(text),
    async tx(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn({ query: (t, p) => client.query(t, p), exec: (t) => client.query(t) })
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

/* int8 arrives as a string from node-postgres and as number|bigint from
   PGlite. Every bigint column crosses into JS through this. Balances are kept
   far below 2^53, so Number is exact. */
export function int(value) {
  if (value == null) return value
  const n = Number(value)
  if (!Number.isSafeInteger(n)) throw new Error(`Integer out of safe range: ${value}`)
  return n
}

export const UNIQUE_VIOLATION = '23505'
