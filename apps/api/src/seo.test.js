/* Search and share metadata of the public site (seo.js, packages/shared/src/seo.js,
   apps/web/public): per-route head, noindex on private pages, real 404s,
   verification tags only when configured, and the static files crawlers read. */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APP_NAME, classifyPath, INDEXABLE_PAGES, OG_IMAGE, SITE_NAME, seoCopy } from '@mirqam-points/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ar from '../../web/src/i18n/ar.js'
import en from '../../web/src/i18n/en.js'
import legal from '../../web/src/pages/public/legal-content.js'
import { createApp } from './app.js'
import { loadConfig, ROOT } from './config.js'
import { openDb } from './db/index.js'
import { renderShell } from './seo.js'

const PUBLIC = join(ROOT, 'apps/web/public')
const SHELL = readFileSync(join(ROOT, 'apps/web/index.html'), 'utf8')
const length = (s) => [...s].length

describe('seo copy', () => {
  it('every public page has a title ≤ 60 and a description ≤ 160 characters, in both languages', () => {
    for (const lang of ['ar', 'en']) {
      for (const page of Object.values(INDEXABLE_PAGES)) {
        const { title, description } = seoCopy[lang][page]
        expect(length(title), `${lang}.${page}.title`).toBeLessThanOrEqual(60)
        expect(length(description), `${lang}.${page}.description`).toBeLessThanOrEqual(160)
        expect(length(description), `${lang}.${page}.description`).toBeGreaterThanOrEqual(120)
      }
    }
    const titles = Object.values(seoCopy.ar).map((c) => c.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('every public title carries the one website name that mirqam.sa uses for the product', () => {
    for (const lang of ['ar', 'en']) {
      const { home, ...rest } = seoCopy[lang]
      expect(home.title.startsWith(`${SITE_NAME[lang]} | `), `${lang}.home`).toBe(true)
      for (const [page, { title }] of Object.entries(rest)) expect(title.endsWith(` | ${SITE_NAME[lang]}`), `${lang}.${page}`).toBe(true)
    }
    for (const f of readdirSync(join(PUBLIC, 'blog')).filter((f) => f.endsWith('.html'))) {
      const html = readFileSync(join(PUBLIC, 'blog', f), 'utf8')
      const title = html.match(/<title>([^<]*)<\/title>/)[1]
      expect(title, f).toContain(SITE_NAME.ar)
      expect(title, f).not.toContain(APP_NAME.ar)
      expect(html, f).toContain(`<meta property="og:site_name" content="${SITE_NAME.ar}">`)
    }
    expect(JSON.parse(readFileSync(join(PUBLIC, 'site.webmanifest'), 'utf8')).name).toBe(SITE_NAME.ar)
  })

  it('classifies console paths: public, private (noindex) or not found', () => {
    for (const p of ['/', '/privacy', '/terms', '/support', '/delete-account']) expect(classifyPath(p), p).toMatchObject({ status: 200, indexable: true })
    expect(classifyPath('/terms/')).toEqual({ status: 301, indexable: false, page: 'terms', location: '/terms' })
    expect(classifyPath('/privacy//')).toMatchObject({ status: 301, location: '/privacy' })
    expect(classifyPath('//privacy').status).toBe(404)
    for (const p of ['/login', '/register', '/app', '/app/members/x', '/p/tok', '/gift/tok', '/join/shop/123', '/hq-admin', '/hq-entry']) {
      expect(classifyPath(p), p).toEqual({ status: 200, indexable: false, page: null })
    }
    for (const p of ['/null', '/design', '/wp-login.php', '/p', '/p/a/b', '/blog/nope.html', '/apps']) expect(classifyPath(p).status, p).toBe(404)
  })
})

describe('renderShell', () => {
  const config = loadConfig({ NODE_ENV: 'test' })

  it('home: unique title, canonical, Open Graph with a 1200×630 image and JSON-LD for the visible product', () => {
    const { status, robots, html } = renderShell(SHELL, '/', config)
    expect(status).toBe(200)
    expect(robots).toBe(null)
    expect(html).toContain(`<title>${seoCopy.ar.home.title}</title>`)
    expect(html.match(/<title>/g)).toHaveLength(1)
    expect(html.match(/name="description"/g)).toHaveLength(1)
    expect(html).toContain('<link rel="canonical" href="https://loyalty.mirqam.sa/" />')
    expect(html).toContain('<meta property="og:image" content="https://loyalty.mirqam.sa/og-image.png" />')
    expect(html).toContain(`<meta property="og:image:alt" content="${OG_IMAGE.alt}" />`)
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(html).toContain('lang="ar" dir="rtl"')
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1])
    expect(ld['@graph'].map((n) => n['@type'])).toEqual(['Organization', 'WebSite', 'SoftwareApplication'])
    // The logo the structured data names is a real public file.
    expect(existsSync(join(PUBLIC, new URL(ld['@graph'][0].logo).pathname)), ld['@graph'][0].logo).toBe(true)
    // One name for the website and the product; the store app's name is an alternate.
    expect(ld['@graph'][1].name).toBe(SITE_NAME.ar)
    expect(ld['@graph'][2].name).toBe(SITE_NAME.ar)
    expect(ld['@graph'][2].alternateName).toContain('Mirqam Points')
    expect(html).toContain(`<meta property="og:site_name" content="${SITE_NAME.ar}" />`)
    expect(html).not.toMatch(/site-verification|msvalidate/)
  })

  it('legal pages get their own title, canonical and breadcrumb', () => {
    const { html } = renderShell(SHELL, '/privacy', config)
    expect(html).toContain(`<title>${seoCopy.ar.privacy.title}</title>`)
    expect(html).toContain('<link rel="canonical" href="https://loyalty.mirqam.sa/privacy" />')
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1])
    expect(ld['@type']).toBe('BreadcrumbList')
  })

  it('private pages are noindex and 404s are real', () => {
    const app = renderShell(SHELL, '/app/members', config)
    expect(app).toMatchObject({ status: 200, robots: 'noindex,nofollow' })
    expect(app.html).toContain('<meta name="robots" content="noindex,nofollow" />')
    expect(app.html).not.toContain('rel="canonical"')
    expect(renderShell(SHELL, '/null', config)).toMatchObject({ status: 404, robots: 'noindex,nofollow' })
    expect(renderShell(SHELL, '/support/', config)).toEqual({ status: 301, location: '/support', robots: null, html: null })
  })

  it('puts the prerendered page inside #root for public pages only, verbatim', () => {
    const prerendered = { home: '<div data-prerendered=""><h1>$& $\' $1 ok</h1></div>', privacy: '<div data-prerendered=""><h1>p</h1></div>' }
    const home = renderShell(SHELL, '/', config, prerendered).html
    expect(home).toContain('<div id="root"><div data-prerendered=""><h1>$& $\' $1 ok</h1></div></div>')
    expect(renderShell(SHELL, '/privacy', config, prerendered).html).toContain('<div id="root"><div data-prerendered=""><h1>p</h1>')
    // No fragment for a page: the empty shell, as before.
    expect(renderShell(SHELL, '/terms', config, prerendered).html).toContain('<div id="root"></div>')
    for (const p of ['/login', '/app', '/null']) expect(renderShell(SHELL, p, config, prerendered).html, p).not.toContain('data-prerendered')
  })

  it('renders verification tags only when configured, escaped', () => {
    const cfg = loadConfig({ NODE_ENV: 'test', GOOGLE_SITE_VERIFICATION: 'g-123"><x', BING_SITE_VERIFICATION: 'B456' })
    const { html } = renderShell(SHELL, '/', cfg)
    expect(html).toContain('<meta name="google-site-verification" content="g-123&quot;&gt;&lt;x" />')
    expect(html).toContain('<meta name="msvalidate.01" content="B456" />')
  })
})

describe('served by the app', () => {
  let db
  let dist
  let server
  let base
  beforeAll(async () => {
    db = await openDb('memory://')
    dist = mkdtempSync(join(tmpdir(), 'mp-seo-'))
    writeFileSync(join(dist, 'index.html'), SHELL)
    mkdirSync(join(dist, 'prerender'))
    writeFileSync(join(dist, 'prerender', 'home.html'), '<div data-prerendered=""><h1>home</h1></div>')
    writeFileSync(join(dist, 'robots.txt'), 'User-agent: *')
    mkdirSync(join(dist, 'blog'))
    writeFileSync(join(dist, 'blog', 'post.html'), '<html><head><title>x</title></head><body></body></html>')
    const config = loadConfig({ NODE_ENV: 'test', WEB_DIST: dist, GOOGLE_SITE_VERIFICATION: 'gtoken' })
    server = createApp({ db, config }).listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await db.close()
    rmSync(dist, { recursive: true, force: true })
  })

  it('answers 404 for unknown paths, noindex headers for private ones, and canonical redirects', async () => {
    const missing = await fetch(`${base}/null`)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('x-robots-tag')).toBe('noindex,nofollow')
    const login = await fetch(`${base}/login`)
    expect(login.status).toBe(200)
    expect(login.headers.get('x-robots-tag')).toBe('noindex,nofollow')
    const home = await fetch(`${base}/`)
    expect(home.headers.get('x-robots-tag')).toBe(null)
    const homeHtml = await home.text()
    expect(homeHtml).toContain('<meta name="google-site-verification" content="gtoken" />')
    expect(homeHtml).toContain('<div id="root"><div data-prerendered=""><h1>home</h1></div></div>')
    expect(await login.text()).not.toContain('data-prerendered')
    for (const [from, to] of [
      ['/index.html', '/'],
      ['/blog', '/blog/index.html'],
      ['/blog/', '/blog/index.html'],
      ['/privacy/?utm_source=x', '/privacy?utm_source=x'],
    ]) {
      const res = await fetch(base + from, { redirect: 'manual' })
      expect(res.status, from).toBe(301)
      expect(res.headers.get('location'), from).toBe(to)
    }
    expect(await (await fetch(`${base}/blog/post.html`)).text()).toContain('<meta name="google-site-verification" content="gtoken" />')
    expect((await fetch(`${base}/blog/missing.html`)).status).toBe(404)
    expect((await fetch(`${base}/robots.txt`)).status).toBe(200)
  })
})

describe('public files', () => {
  it('icons, manifest and share image exist; the share image is 1200×630', () => {
    for (const f of [
      'favicon.ico',
      'favicon.svg',
      'apple-touch-icon.png',
      'icon-192.png',
      'icon-512.png',
      'brand/mirqam-logo-512.png',
      'site.webmanifest',
      'og-image.png',
    ]) {
      expect(existsSync(join(PUBLIC, f)), f).toBe(true)
    }
    const og = readFileSync(join(PUBLIC, 'og-image.png'))
    expect([og.readUInt32BE(16), og.readUInt32BE(20)]).toEqual([1200, 630])
    const manifest = JSON.parse(readFileSync(join(PUBLIC, 'site.webmanifest'), 'utf8'))
    for (const icon of manifest.icons) expect(existsSync(join(PUBLIC, icon.src)), icon.src).toBe(true)
  })

  it('robots.txt keeps crawlers out of the console, API and member pages, not the public files, and lists the sitemap', () => {
    const robots = readFileSync(join(PUBLIC, 'robots.txt'), 'utf8')
    // Google's matching: the longest matching rule wins, Allow on a tie; `*` and a final `$` are patterns.
    const rules = [...robots.matchAll(/^(Allow|Disallow):\s*(\S+)/gm)].map(([, kind, path]) => ({
      kind,
      length: path.length,
      re: new RegExp(
        `^${path
          .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\\?\$$/, '$')}`,
      ),
    }))
    const allowed = (path) => {
      const hits = rules.filter((r) => r.re.test(path)).sort((a, b) => b.length - a.length || (a.kind === 'Allow' ? -1 : 1))
      return !hits.length || hits[0].kind === 'Allow'
    }
    for (const p of [
      '/app',
      '/app/members/1',
      '/login',
      '/register',
      '/hq-admin',
      '/hq-entry',
      '/api/health',
      '/p/t',
      '/gift/t',
      '/join/s/1',
      '/live-update/manifest.json',
    ]) {
      expect(allowed(p), p).toBe(false)
    }
    for (const p of [
      '/',
      '/privacy',
      '/delete-account',
      '/blog/index.html',
      '/apple-touch-icon.png',
      '/app-store-badge.svg',
      '/og-image.png',
      '/favicon.ico',
      '/assets/index.js',
    ]) {
      expect(allowed(p), p).toBe(true)
    }
    expect(robots).toContain('Sitemap: https://loyalty.mirqam.sa/sitemap.xml')
  })

  it('the sitemap lists every blog article and public page with a lastmod, and nothing private', () => {
    const sitemap = readFileSync(join(PUBLIC, 'sitemap.xml'), 'utf8')
    const urls = [...sitemap.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod><\/url>/g)].map((m) => m[1])
    expect(urls.length).toBe((sitemap.match(/<url>/g) || []).length)
    for (const f of readdirSync(join(PUBLIC, 'blog')).filter((f) => f.endsWith('.html'))) expect(urls).toContain(`https://loyalty.mirqam.sa/blog/${f}`)
    for (const p of Object.keys(INDEXABLE_PAGES)) expect(urls).toContain(`https://loyalty.mirqam.sa${p}`)
    for (const u of urls) expect(classifyPath(new URL(u).pathname).indexable || u.includes('/blog/'), u).toBe(true)
  })

  it('blog pages: one h1, title ≤ 60, description ≤ 160, canonical, share image, alt text, no /null links', () => {
    for (const f of readdirSync(join(PUBLIC, 'blog')).filter((f) => f.endsWith('.html'))) {
      const html = readFileSync(join(PUBLIC, 'blog', f), 'utf8')
      expect(html.match(/<h1\b/g), f).toHaveLength(1)
      expect(html, f).toContain('<html lang="ar" dir="rtl"')
      expect(length(html.match(/<title>([^<]*)<\/title>/)[1]), f).toBeLessThanOrEqual(60)
      expect(length(html.match(/<meta name="description" content="([^"]*)"/)[1]), f).toBeLessThanOrEqual(160)
      expect(html, f).toContain(`<link rel="canonical" href="https://loyalty.mirqam.sa/blog/${f}">`)
      expect(html, f).toContain('<meta property="og:image" content="https://loyalty.mirqam.sa/og-image.png">')
      expect(html, f).toContain(`<meta property="og:image:alt" content="${OG_IMAGE.alt}">`)
      expect(html, f).toContain('<link rel="icon" href="/favicon.ico"')
      for (const img of html.match(/<img\b[^>]*>/g) || []) expect(img, f).toMatch(/\balt="/)
      expect(html, f).not.toMatch(/href="[^"]*\/null"/)
    }
  })

  it('nothing public mentions AI tooling or placeholder text', () => {
    const files = [
      join(ROOT, 'apps/web/index.html'),
      ...readdirSync(PUBLIC).map((f) => join(PUBLIC, f)),
      ...readdirSync(join(PUBLIC, 'blog')).map((f) => join(PUBLIC, 'blog', f)),
      ...readdirSync(join(PUBLIC, 'brand')).map((f) => join(PUBLIC, 'brand', f)),
    ]
    for (const f of files.filter((f) => /\.(html|js|css|txt|xml|svg|webmanifest)$/.test(f))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/\b(claude|chatgpt|openai|codex|qoder|copilot|lorem ipsum)\b|ai-generated|name="generator"/i)
    }
  })

  it('public marketing and legal copy avoids stock phrases and the em-dash habit', () => {
    const strings = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [])
    const copy = [...strings(ar.landing), ...strings(en.landing), ...strings(seoCopy), ...strings(legal)]
    expect(copy.length).toBeGreaterThan(50)
    const tells =
      /—|في عالم اليوم|ارتقِ|ارتق بأعمالك|حلول مبتكرة|بكل سهولة|سلاسة|اكتشف قوة|تجربة استثنائية|الحل الأمثل|\b(seamless|unlock|elevate|empower|revolutioni[sz]e|cutting-edge|game-changer|effortless|robust)\b/i
    for (const s of copy) expect(s).not.toMatch(tells)
  })
})
