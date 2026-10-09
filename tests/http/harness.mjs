/* Minimal HTTP test harness. Prints one PASS/FAIL line per check and a
   summary; the runner exits non-zero if any check fails. Each Agent keeps its
   own cookie jar so tests can act as different staff in different tenants. */
import { randomUUID } from 'node:crypto'

export const BASE = (process.env.BASE || 'http://localhost:4100').replace(/\/$/, '')

const results = { pass: 0, fail: 0, failures: [] }

export async function check(name, fn) {
  try {
    await fn()
    results.pass += 1
    console.log(`PASS ${name}`)
  } catch (err) {
    results.fail += 1
    results.failures.push(name)
    console.log(`FAIL ${name}\n     ${err.message}`)
  }
}

export function summary() {
  console.log(`\n${results.pass} passed, ${results.fail} failed`)
  if (results.failures.length) console.log(`Failed:\n - ${results.failures.join('\n - ')}`)
  return results.fail
}

export function expect(actual, label = 'value') {
  const fail = (msg) => {
    throw new Error(`${label}: ${msg}`)
  }
  return {
    toBe(want) {
      if (actual !== want) fail(`expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
    },
    toBeTruthy() {
      if (!actual) fail(`expected truthy, got ${JSON.stringify(actual)}`)
    },
    toMatch(re) {
      if (!re.test(String(actual))) fail(`expected to match ${re}, got ${JSON.stringify(actual)}`)
    },
  }
}

/** Asserts status and (optionally) the error code of a response. */
export function expectStatus(res, status, error) {
  if (res.status !== status) throw new Error(`expected HTTP ${status}, got ${res.status} ${JSON.stringify(res.body)}`)
  if (error && res.body?.error !== error) throw new Error(`expected error "${error}", got ${JSON.stringify(res.body)}`)
}

export const key = () => `k-${randomUUID()}`

/** Reads pass.json out of a STORE-method .pkpass (what our server produces). */
export function passJsonFrom(buf) {
  let i = 0
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18)
    const nameLen = buf.readUInt16LE(i + 26)
    const extra = buf.readUInt16LE(i + 28)
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString()
    const start = i + 30 + nameLen + extra
    if (name === 'pass.json') return JSON.parse(buf.subarray(start, start + size).toString())
    i = start + size
  }
  throw new Error('pass.json not found in pkpass')
}
export const uniq = () => randomUUID().slice(0, 8)
export const phone = () => `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

export class Agent {
  cookie = ''

  async request(method, path, { body, headers = {}, raw, binary } = {}) {
    const init = { method, headers: { ...headers }, redirect: 'manual' }
    if (this.cookie) init.headers.cookie = this.cookie
    if (body !== undefined) {
      init.headers['content-type'] ??= 'application/json'
      init.body = raw ?? JSON.stringify(body)
    }
    const res = await fetch(`${BASE}${path}`, init)
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) this.cookie = setCookie.split(';')[0].endsWith('=') ? '' : setCookie.split(';')[0]
    if (binary) return { status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: res.headers }
    const text = await res.text()
    let parsed
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }
    return { status: res.status, body: parsed, headers: res.headers }
  }

  get = (path, opts) => this.request('GET', path, opts)
  post = (path, body, opts = {}) => this.request('POST', path, { ...opts, body: body ?? {} })
  patch = (path, body, opts = {}) => this.request('PATCH', path, { ...opts, body })
  delete = (path, opts = {}) => this.request('DELETE', path, { ...opts, body: {} })

  /** Registers a new owner + workspace and keeps the session. */
  static async owner() {
    const a = new Agent()
    const id = uniq()
    const res = await a.post('/api/auth/register', {
      email: `owner-${id}@example.test`,
      password: 'correct-horse-9',
      name: `Owner ${id}`,
      businessName: `Store ${id}`,
    })
    expectStatus(res, 201)
    a.me = res.body
    return a
  }

  /** Creates a staff member in `owner`'s workspace and returns an agent logged in as them. */
  static async staff(owner, role) {
    const email = `${role}-${uniq()}@example.test`
    expectStatus(await owner.post('/api/staff', { email, name: role, role, password: 'staff-pass-123' }), 201)
    const a = new Agent()
    const res = await a.post('/api/auth/login', { email, password: 'staff-pass-123' })
    expectStatus(res, 200)
    a.me = res.body
    return a
  }
}
