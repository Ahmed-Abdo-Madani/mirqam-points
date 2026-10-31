/* Standby (runtime-mode.js): the process answers health checks and nothing
   else — no database connection, no migration, no background job. A new
   service (mirqam-points-fra) sits here, secrets entered, until the cutover
   sets MIRQAM_LIVE=1.

   Optional, for operators without a shell: MIRQAM_COPY_ON_BOOT=copy|replace|verify
   runs the database copy (db/copy-cli.js) once after boot and logs the result.
   Honoured in standby only — a live service never copies over its own data. */
import http from 'node:http'

export function createStandbyServer({ version }) {
  return http.createServer((req, res) => {
    const health = req.url === '/api/health' || req.url === '/health'
    res.writeHead(health ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(health ? {} : { 'retry-after': '60' }) })
    res.end(JSON.stringify(health ? { ok: true, standby: true, version } : { error: 'maintenance' }))
  })
}

export async function startStandby({ port, version, env = process.env, log = console.log }) {
  const server = createStandbyServer({ version })
  await new Promise((resolve) => server.listen(port, resolve))
  log(`[launch] standby on port ${server.address().port}: health checks only (set MIRQAM_LIVE=1 to start the app)`)
  const copy = env.MIRQAM_COPY_ON_BOOT
  if (copy === 'copy' || copy === 'replace' || copy === 'verify') {
    const { runCopy } = await import('./db/copy-cli.js')
    const code = await runCopy({ mode: copy, env, log: (line) => log(`[copy] ${line}`) })
    log(`[copy] finished with exit code ${code}`)
  }
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  return server
}
