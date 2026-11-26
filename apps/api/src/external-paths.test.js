/* Paths that other systems and customers open must keep their handlers now that
   the console's shell answers unknown paths with 404 and public pages with a
   trailing slash with 301 (seo.js): wallet-pass web services, the POS bridge,
   customers' card, gift and join links (also from QR codes), the HQ entry,
   live updates, billing and sign-in returns. And the search output must name
   the public site even where PUBLIC_URL is another host (render.yaml gives the
   Oregon service https://points.mirqam.sa, which has no DNS). */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { loadConfig, ROOT } from './config.js'
import { openDb } from './db/index.js'
import { migrate } from './db/migrate.js'

const PUBLIC = join(ROOT, 'apps/web/public')
let db
let dist
let server
let base

beforeAll(async () => {
  db = await openDb('memory://')
  await migrate(db)
  dist = mkdtempSync(join(tmpdir(), 'mp-ext-'))
  writeFileSync(join(dist, 'index.html'), readFileSync(join(ROOT, 'apps/web/index.html'), 'utf8'))
  mkdirSync(join(dist, 'brand'))
  copyFileSync(join(PUBLIC, 'brand/pass-logo.png'), join(dist, 'brand/pass-logo.png'))
  mkdirSync(join(dist, 'live-update'))
  writeFileSync(join(dist, 'live-update/manifest.json'), '{"id":"x"}')
  mkdirSync(join(dist, 'prerender'))
  writeFileSync(join(dist, 'prerender/home.html'), '<div data-prerendered=""><h1>home</h1></div>')
  const config = loadConfig({ NODE_ENV: 'test', WEB_DIST: dist, PUBLIC_URL: 'https://points.mirqam.sa' })
  server = createApp({ db, config }).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await db.close()
  rmSync(dist, { recursive: true, force: true })
})

const get = (path, init) => fetch(base + path, { redirect: 'manual', ...init })
// The console's not-found page: what an external path must never get.
const isShell404 = (res) => res.status === 404 && /text\/html/.test(res.headers.get('content-type') || '')

describe('paths opened by other systems and by customers', () => {
  it("customers' card, gift and join links (also from QR codes) and partner entry points open the console", async () => {
    for (const path of [
      '/p/0123456789abcdef',
      '/p/0123456789abcdef/',
      '/gift/0123456789abcdef',
      '/gift/0123456789abcdef/',
      '/join/coffee-shop/9b0c2a4e-1111-4222-8333-944455556666',
      '/join/coffee-shop/9b0c2a4e-1111-4222-8333-944455556666/',
      '/hq-entry?token=abc',
      '/app',
      '/app/billing?checkout=abc',
      '/login?social=abc',
      '/register',
    ]) {
      const res = await get(path)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('content-type'), path).toMatch(/text\/html/)
      expect(res.headers.get('x-robots-tag'), path).toBe('noindex,nofollow')
    }
  })

  it('the public pages answer 200 at the addresses the stores and the apps link to', async () => {
    for (const path of ['/', '/privacy', '/terms', '/support', '/delete-account']) expect((await get(path)).status, path).toBe(200)
  })

  it('the POS bridge pages and assets keep their own handlers; its sign-in pages are noindex', async () => {
    for (const path of ['/pos/install', '/pos/connect', '/pos/embedded?link=abc', '/pos/embedded/']) {
      const res = await get(path)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('content-type'), path).toMatch(/text\/html/)
      expect(res.headers.get('x-robots-tag'), path).toBe('noindex,nofollow')
      expect(await res.text(), path).not.toContain('<div id="root">')
    }
    for (const path of ['/pos/bridge.js', '/pos/bridge.css', '/pos/config', '/pos/font.otf', '/pos/logo.svg']) {
      const res = await get(path)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('x-robots-tag'), path).toBe(null)
    }
    expect((await get('/pos/config')).headers.get('content-type')).toMatch(/json/)
  })

  it('wallet-pass web services and public pass endpoints are answered by the API, never by the shell', async () => {
    const cases = [
      // Apple Wallet web service (webServiceURL = <PUBLIC_URL>/api/wallet/apple): the protocol's own answers.
      ['GET', '/api/wallet/apple/v1/devices/dev1/registrations/pass.sa.mirqam.points', 204],
      ['GET', '/api/wallet/apple/v1/passes/pass.sa.mirqam.points/acct-x', 401],
      ['POST', '/api/wallet/apple/v1/devices/dev1/registrations/pass.sa.mirqam.points/acct-x', 401],
      ['DELETE', '/api/wallet/apple/v1/devices/dev1/registrations/pass.sa.mirqam.points/acct-x', 401],
    ]
    for (const [method, path, status] of cases) {
      const res = await get(path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined })
      expect(res.status, `${method} ${path}`).toBe(status)
      expect(isShell404(res), path).toBe(false)
    }
    const log = await get('/api/wallet/apple/v1/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"logs":["x"]}' })
    expect(log.status).toBeLessThan(300)
    // Card, gift and Google Wallet links of an unknown token: the API's JSON answer, not the shell.
    for (const path of ['/api/public/pass/nope', '/api/public/pass/nope/google', '/api/public/gift/nope', '/api/public/logo/nope']) {
      const res = await get(path)
      expect(res.headers.get('content-type'), path).toMatch(/json/)
      expect(isShell404(res), path).toBe(false)
    }
  })

  it('live updates, the old APK link, the Google Wallet logo and the health check keep working', async () => {
    const update = await get('/api/mobile/live-update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: 'sa.mirqam.points', version_build: '1.1.0', version_name: 'builtin' }),
    })
    expect(update.status).toBe(200)
    expect((await get('/live-update/manifest.json')).status).toBe(200)
    const apk = await get('/downloads/mirqam-points.apk')
    expect(apk.status).toBe(301)
    expect(apk.headers.get('location')).toBe('https://play.google.com/store/apps/details?id=sa.mirqam.points')
    expect((await get('/brand/pass-logo.png')).status).toBe(200)
    expect((await get('/api/health')).status).toBe(200)
  })

  it('/.well-known has no resource here, so it answers 404 (it was the console HTML with 200)', async () => {
    for (const path of ['/.well-known/assetlinks.json', '/.well-known/apple-app-site-association']) expect((await get(path)).status, path).toBe(404)
  })
})

describe('search output ignores PUBLIC_URL', () => {
  it('names https://loyalty.mirqam.sa in the canonical, og:url and structured data even with PUBLIC_URL=https://points.mirqam.sa', async () => {
    for (const [path, url] of [
      ['/', 'https://loyalty.mirqam.sa/'],
      ['/privacy', 'https://loyalty.mirqam.sa/privacy'],
    ]) {
      const html = await (await get(path)).text()
      expect(html, path).toContain(`<link rel="canonical" href="${url}" />`)
      expect(html, path).toContain(`<meta property="og:url" content="${url}" />`)
      expect(html, path).toContain('<meta property="og:image" content="https://loyalty.mirqam.sa/og-image.png" />')
      const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]
      expect(ld, path).toContain('https://loyalty.mirqam.sa/')
      expect(html, path).not.toContain('points.mirqam.sa')
    }
    for (const file of ['sitemap.xml', 'robots.txt']) expect(readFileSync(join(PUBLIC, file), 'utf8'), file).not.toContain('points.mirqam.sa')
  })
})
