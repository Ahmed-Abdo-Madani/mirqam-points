/* Scanner traffic such as `GET /%c0` carries malformed percent-encoding.
   decodeURIComponent throws URIError in the router (route params) and in the
   static file server; both must answer 400, never 500. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { openDb } from './db/index.js'
import { migrate } from './db/migrate.js'
import { errorHandler } from './http.js'

describe('malformed URLs', () => {
  let db
  let dist
  let server
  let base
  beforeAll(async () => {
    db = await openDb('memory://')
    await migrate(db)
    dist = mkdtempSync(join(tmpdir(), 'mp-web-'))
    mkdirSync(join(dist, 'assets'))
    writeFileSync(join(dist, 'index.html'), '<!doctype html><html><head></head><body>console</body></html>')
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)')
    server = createApp({ db, config: loadConfig({ NODE_ENV: 'test', WEB_DIST: dist }) }).listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await db.close()
    rmSync(dist, { recursive: true, force: true })
  })

  it('answers 400 bad_request for the console, static files and the API, and logs nothing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const path of ['/%c0', '/%E0%A4%A', '/assets/%c0', '/assets/app%ff.js', '/blog/%c0.html', '/api/%c0', '/api/public/%c0', '/x%']) {
        const res = await fetch(base + path)
        expect(res.status, path).toBe(400)
        expect(await res.json(), path).toEqual({ error: 'bad_request' })
        expect(res.headers.get('x-content-type-options'), path).toBe('nosniff')
      }
      expect(logged).not.toHaveBeenCalled()
    } finally {
      logged.mockRestore()
    }
  })

  it('still serves well-formed paths, including encoded ones', async () => {
    expect((await fetch(`${base}/`)).status).toBe(200)
    expect((await fetch(`${base}/assets/app.js`)).status).toBe(200)
    const spa = await fetch(`${base}/app/members/%D8%B9%D8%B6%D9%88`)
    expect(spa.status).toBe(200)
    expect(await spa.text()).toContain('console')
    expect((await fetch(`${base}/api/nope%20x`)).status).toBe(404)
  })

  it('a malformed JSON body keeps its own code (invalid_json), an oversized one payload_too_large', async () => {
    for (const path of ['/api/auth/login', '/api/pos/loyalty/status', '/api/mobile/live-update']) {
      const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })
      expect(res.status, path).toBe(400)
      expect(await res.json(), path).toEqual({ error: 'invalid_json' })
    }
    const big = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: 'a'.repeat(70_000) }),
    })
    expect(big.status).toBe(413)
  })

  it('answers an absurdly long path (15,000 slashes) with 404 at once, not after seconds of matching', async () => {
    const path = `/${'/'.repeat(15_000)}x`
    const times = []
    for (let i = 0; i < 5; i++) {
      const started = performance.now()
      const res = await fetch(base + path)
      times.push(performance.now() - started)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found' })
    }
    // Before the fix each request blocked the event loop for about 80 ms on its own.
    expect(times.sort((a, b) => a - b)[2]).toBeLessThan(50)
    expect((await fetch(`${base}/app${'/'.repeat(3000)}x`)).status).toBe(404)
  })

  it('the error handler maps a URIError reaching it to 400', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    errorHandler(new URIError('URI malformed'), { method: 'GET', originalUrl: '/x' }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'bad_request' })
  })
})
