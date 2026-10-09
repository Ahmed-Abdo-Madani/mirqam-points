#!/usr/bin/env node
/* Mandatory post-edit gate (see AGENTS.md).
   1. Unit tests (vitest): ledger invariants, earn rules, phone normalization.
   2. Boots the API on a free port with an in-memory Postgres (PGlite, or
      VERIFY_DATABASE_URL when set), waits
      for /api/health, runs the HTTP battery, tears the server down.
   3. Builds the web console (catches JSX/CSS/Tailwind errors).
   Exit code 0 only if every stage passes. Pass --skip-build to omit stage 3. */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const skipBuild = process.argv.includes('--skip-build')

// npm/npx are .cmd shims on Windows and need a shell; give the shell one
// pre-joined command string (all arguments here are fixed literals).
function run(cmd, args, opts = {}) {
  const shell = opts.shell ?? process.platform === 'win32'
  return new Promise((resolve) => {
    const child = shell
      ? spawn([cmd, ...args].join(' '), { cwd: ROOT, stdio: 'inherit', ...opts, shell: true })
      : spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

async function waitForHealth(base, server, timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (server.exitCode !== null) return false
    try {
      const res = await fetch(`${base}/api/health`)
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

const stages = []

console.log('\n== 1/3 unit tests ==')
stages.push(['unit', await run('npx', ['vitest', 'run'])])

console.log('\n== 2/3 HTTP battery ==')
const port = await freePort()
const base = `http://localhost:${port}`
const server = spawn(process.execPath, ['apps/api/src/server.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    // CI sets VERIFY_DATABASE_URL to a real Postgres service; locally it is an in-memory PGlite.
    DATABASE_URL: process.env.VERIFY_DATABASE_URL || 'memory://',
    PUBLIC_URL: base,
    AUTH_RATE_LIMIT: '1000',
    WEB_DIST: join(ROOT, '.verify-no-dist'),
  },
})
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))
if (await waitForHealth(base, server)) {
  stages.push(['http', await run(process.execPath, ['tests/http/run.mjs'], { env: { ...process.env, BASE: base }, shell: false })])
} else {
  console.log(`FAIL server did not become healthy\n${serverLog}`)
  stages.push(['http', 1])
}
server.kill()
if (/\[api\] (GET|POST|PATCH|DELETE) /.test(serverLog)) {
  console.log('\nServer reported unhandled errors during the battery:')
  console.log(
    serverLog
      .split('\n')
      .filter((l) => /\[api\]|Error/.test(l))
      .slice(0, 20)
      .join('\n'),
  )
  stages.push(['server-errors', 1])
}

if (!skipBuild) {
  console.log('\n== 3/3 web build ==')
  stages.push(['build', await run('npm', ['run', 'build', '-w', '@mirqam-points/web'])])
}

console.log('\n== verify summary ==')
for (const [name, code] of stages) console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${name} (exit ${code})`)
const failed = stages.some(([, code]) => code !== 0)
process.exit(failed ? 1 : 0)
