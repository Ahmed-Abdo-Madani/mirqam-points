/* Copy the whole Points database into another Postgres, and verify it — the
   data step of the Frankfurt move (RUNBOOK.md, "Move to Frankfurt").

   Works on two single-connection sessions (`{ query(text, params) }`):
   node-postgres Clients in production, PGlite in tests.

   copy (mode 'copy' | 'replace')
   - the target schema comes from the app's own migrations (run by the
     caller) and must have applied EXACTLY the source's migrations — so both
     services run the same release and no data migration is skipped;
   - the source is read inside one REPEATABLE READ READ ONLY transaction: a
     consistent snapshot even while the source is still serving traffic
     (rehearsal); at the cutover writes are frozen anyway;
   - the target is written inside ONE transaction: foreign keys are dropped,
     the tables are (in 'replace') emptied, every row is copied through its
     text representation (lossless for every type: microsecond timestamps,
     jsonb, arrays, bytea, numeric), the foreign keys are re-created (which
     re-validates every reference), sequences are set to the source's values,
     and every table is verified (row count + order-independent checksum)
     before COMMIT. Any failure rolls the target back to what it was;
   - 'copy' refuses a target that already holds rows; 'replace' re-copies
     over a previous run (idempotent).
   verify: compares migrations, row counts, checksums and sequences; writes
   nothing. Never logs connection strings. */

const SKIP = new Set(['schema_migrations']) // created by migrate(); compared, never copied
const q = (name) => `"${String(name).replace(/"/g, '""')}"`
// Same text forms on both sides: checksums compare exactly and values round-trip.
const SESSION = [
  "SET TimeZone = 'UTC'",
  "SET DateStyle = 'ISO, YMD'",
  "SET IntervalStyle = 'postgres'",
  'SET extra_float_digits = 3',
  "SET bytea_output = 'hex'",
]

export class CopyError extends Error {}

async function prepare(session) {
  for (const sql of SESSION) await session.query(sql)
}

export async function tablesOf(session) {
  const { rows } = await session.query(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema() AND c.relkind = 'r' ORDER BY 1`,
  )
  return rows.map((r) => r.name)
}

async function columnsOf(session, table) {
  const { rows } = await session.query(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attidentity AS identity, a.attgenerated AS generated
     FROM pg_attribute a
     WHERE a.attrelid = to_regclass(quote_ident(current_schema()) || '.' || quote_ident($1)) AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [table],
  )
  return rows
}

async function migrationsOf(session) {
  const exists = await session.query(`SELECT to_regclass(quote_ident(current_schema()) || '.schema_migrations') IS NOT NULL AS ok`)
  if (!exists.rows[0].ok) return []
  return (await session.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name)
}

async function sequencesOf(session) {
  const { rows } = await session.query(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema() AND c.relkind = 'S' ORDER BY 1`,
  )
  const out = []
  for (const { name } of rows) {
    const r = (await session.query(`SELECT last_value::text AS v, is_called FROM ${q(name)}`)).rows[0]
    out.push({ name, value: r.v, called: r.is_called })
  }
  return out
}

/** Row count + order-independent checksum over every column's text form. */
async function fingerprint(session, table, columns) {
  const row = columns.length ? `ROW(${columns.map((c) => q(c.name)).join(', ')})::text` : "''"
  const { rows } = await session.query(
    `SELECT count(*)::text AS n, coalesce(sum(('x' || substr(md5(${row}), 1, 15))::bit(60)::bigint), 0)::text AS h FROM ${q(table)}`,
  )
  return { rows: Number(rows[0].n), hash: rows[0].h }
}

/* Two sessions on the SAME database would make 'replace' empty the source.
   Advisory locks are per database: a lock held by the target session cannot
   be taken by the source session when both are the same database. */
async function assertDistinct(source, target) {
  if (source === target) throw new CopyError('source and target are the same database')
  const key = 0x6d71706f // "mqpo"
  await target.query('SELECT pg_advisory_lock($1)', [key])
  try {
    const { rows } = await source.query('SELECT pg_try_advisory_lock($1) AS got', [key])
    if (!rows[0].got) throw new CopyError('source and target are the same database')
    await source.query('SELECT pg_advisory_unlock($1)', [key])
  } finally {
    await target.query('SELECT pg_advisory_unlock($1)', [key])
  }
}

async function compareSchemas(source, target, log) {
  const [src, dst] = [await migrationsOf(source), await migrationsOf(target)]
  const missing = src.filter((m) => !dst.includes(m))
  const extra = dst.filter((m) => !src.includes(m))
  if (missing.length || extra.length) {
    throw new CopyError(
      `migrations differ (source ${src.at(-1) || 'none'}, target ${dst.at(-1) || 'none'}; missing on target: ${missing.join(', ') || '-'}; only on target: ${extra.join(', ') || '-'}). Deploy the same release on both services first.`,
    )
  }
  log(`schema: both at ${src.at(-1) || 'no migrations'} (${src.length} migrations)`)
  const tables = (await tablesOf(source)).filter((t) => !SKIP.has(t))
  const targetTables = new Set(await tablesOf(target))
  const plan = []
  for (const table of tables) {
    if (!targetTables.has(table)) throw new CopyError(`table ${table} exists on the source only (schema drift)`)
    const [sc, tc] = [await columnsOf(source, table), await columnsOf(target, table)]
    const sig = (cols) => cols.map((c) => `${c.name}:${c.type}`).join(',')
    if (sig(sc) !== sig(tc)) throw new CopyError(`table ${table} has different columns on source and target (schema drift)`)
    plan.push({ table, columns: tc })
  }
  return plan
}

async function verifyTables(source, target, plan, log) {
  let failed = 0
  for (const { table, columns } of plan) {
    const [s, d] = [await fingerprint(source, table, columns), await fingerprint(target, table, columns)]
    const ok = s.rows === d.rows && s.hash === d.hash
    if (!ok) failed += 1
    log(`${ok ? 'OK  ' : 'FAIL'} ${table}: source ${s.rows} rows, target ${d.rows} rows${ok ? '' : s.rows === d.rows ? ' (content differs)' : ''}`)
  }
  return failed
}

async function copyTable(source, target, { table, columns }, batchRows) {
  const cols = columns.filter((c) => !c.generated)
  if (!cols.length) return 0
  const names = cols.map((c) => q(c.name)).join(', ')
  const overriding = cols.some((c) => c.identity) ? ' OVERRIDING SYSTEM VALUE' : ''
  const perStatement = Math.max(1, Math.min(batchRows, Math.floor(30_000 / cols.length)))
  await source.query(`DECLARE mirqam_copy NO SCROLL CURSOR FOR SELECT ${cols.map((c, i) => `${q(c.name)}::text AS c${i}`).join(', ')} FROM ${q(table)}`)
  let copied = 0
  try {
    for (;;) {
      const { rows } = await source.query(`FETCH ${perStatement} FROM mirqam_copy`)
      if (!rows.length) break
      const params = []
      const tuples = rows.map(
        (row) =>
          `(${cols
            .map((c, i) => {
              params.push(row[`c${i}`])
              return `$${params.length}::${c.type}`
            })
            .join(', ')})`,
      )
      await target.query(`INSERT INTO ${q(table)} (${names})${overriding} VALUES ${tuples.join(', ')}`, params)
      copied += rows.length
    }
  } finally {
    await source.query('CLOSE mirqam_copy')
  }
  return copied
}

/**
 * Copies source → target. mode: 'copy' (target must be empty) or 'replace'.
 * Returns { tables, rows }. Throws CopyError (target unchanged) on any failure.
 */
export async function copyDatabase({ source, target, mode = 'copy', log = console.log, batchRows = 500 }) {
  if (mode !== 'copy' && mode !== 'replace') throw new CopyError(`unknown mode ${mode}`)
  await prepare(source)
  await prepare(target)
  await assertDistinct(source, target)
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  await target.query('BEGIN')
  try {
    const plan = await compareSchemas(source, target, log)
    if (mode === 'copy') {
      for (const { table } of plan) {
        const { rows } = await target.query(`SELECT EXISTS (SELECT 1 FROM ${q(table)}) AS used`)
        if (rows[0].used) throw new CopyError(`target table ${table} already has rows; use --replace to re-copy over a previous run`)
      }
    }
    // Foreign keys go while rows arrive in any order, and come back (re-validated) before COMMIT.
    const fks = (
      await target.query(
        `SELECT conrelid::regclass::text AS tbl, conname AS name, pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE contype = 'f' AND connamespace = current_schema()::regnamespace ORDER BY conrelid::regclass::text, conname`,
      )
    ).rows
    for (const fk of fks) await target.query(`ALTER TABLE ${fk.tbl} DROP CONSTRAINT ${q(fk.name)}`)
    if (mode === 'replace' && plan.length) await target.query(`TRUNCATE ${plan.map((p) => q(p.table)).join(', ')}`)
    let total = 0
    for (const entry of plan) {
      const n = await copyTable(source, target, entry, batchRows)
      total += n
      log(`copied ${entry.table}: ${n} rows`)
    }
    for (const fk of fks) await target.query(`ALTER TABLE ${fk.tbl} ADD CONSTRAINT ${q(fk.name)} ${fk.def}`)
    log(`foreign keys re-created and validated: ${fks.length}`)
    // Sequences continue where the source is (identity columns included), never below a copied value.
    const targetSeqs = new Set((await sequencesOf(target)).map((s) => s.name))
    for (const seq of await sequencesOf(source)) {
      if (!targetSeqs.has(seq.name)) throw new CopyError(`sequence ${seq.name} exists on the source only (schema drift)`)
      await target.query('SELECT setval($1::regclass, $2::bigint, $3)', [q(seq.name), seq.value, seq.called])
    }
    const failed = await verifyTables(source, target, plan, log)
    if (failed) throw new CopyError(`${failed} table(s) differ after the copy`)
    await target.query('COMMIT')
    return { tables: plan.length, rows: total }
  } catch (err) {
    await target.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await source.query('ROLLBACK').catch(() => {})
  }
}

/** Compares source and target without writing. Returns the number of problems (0 = identical). */
export async function verifyDatabase({ source, target, log = console.log }) {
  await prepare(source)
  await prepare(target)
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  await target.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    const plan = await compareSchemas(source, target, log)
    let failed = await verifyTables(source, target, plan, log)
    const dst = new Map((await sequencesOf(target)).map((s) => [s.name, s]))
    for (const seq of await sequencesOf(source)) {
      const t = dst.get(seq.name)
      const behind = !t || BigInt(t.value) < BigInt(seq.value) || (BigInt(t.value) === BigInt(seq.value) && seq.called && !t.called)
      if (behind) {
        failed += 1
        log(`FAIL sequence ${seq.name}: target behind the source`)
      }
    }
    return failed
  } finally {
    await source.query('ROLLBACK').catch(() => {})
    await target.query('ROLLBACK').catch(() => {})
  }
}
