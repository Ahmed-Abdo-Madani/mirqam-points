#!/usr/bin/env node
/* Renders the website's icons and share image (run after changing the logo or
   the product tagline). Output in apps/web/public, committed:
   - favicon.svg                the Mirqam wordmark on navy (brand/mirqam-dark.svg)
   - favicon.ico                16, 32 and 48 px (PNG entries) from favicon.svg
   - apple-touch-icon.png       180 px  ┐ from the Points app icon
   - icon-192.png, icon-512.png         ┘ (apps/mobile/assets/icon-only.png, scripts/gen-assets.mjs)
   - brand/mirqam-logo-512.png  the Organization logo of the structured data
   - og-image.png               1200×630 Open Graph / Twitter card
   The share image is laid out in HTML and rendered by headless Chromium with
   the blog's IBM Plex Sans Arabic (embedded, and checked to have loaded),
   because librsvg cannot shape Arabic without a system font. Needs Playwright
   with Chromium (`require('playwright')`).
   Usage: node scripts/gen-web-icons.mjs */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'apps/web/public')
const wordmarkSvg = readFileSync(join(PUBLIC, 'brand/mirqam-dark.svg'), 'utf8')
const appIcon = readFileSync(join(ROOT, 'apps/mobile/assets/icon-only.png'))

// The wordmark's own viewBox (880×660) centred on a navy rounded square.
const inner = wordmarkSvg
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<title>[^<]*<\/title>/, '')
const viewBox = wordmarkSvg.match(/viewBox="([^"]+)"/)[1]
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="200" fill="#172740"/><svg x="92" y="167" width="840" height="630" viewBox="${viewBox}">${inner}</svg></svg>\n`
writeFileSync(join(PUBLIC, 'favicon.svg'), favicon)

const png = (size) => sharp(Buffer.from(favicon), { density: 300 }).resize(size, size).png().toBuffer()
const iconPng = (size) => sharp(appIcon).resize(size, size).png().toBuffer()

/* ICO with PNG entries (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + 16 * images.length
  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

const sizes = [16, 32, 48]
writeFileSync(join(PUBLIC, 'favicon.ico'), ico(await Promise.all(sizes.map(async (size) => ({ size, data: await png(size) })))))
writeFileSync(join(PUBLIC, 'apple-touch-icon.png'), await iconPng(180))
writeFileSync(join(PUBLIC, 'icon-192.png'), await iconPng(192))
writeFileSync(join(PUBLIC, 'icon-512.png'), await iconPng(512))
writeFileSync(join(PUBLIC, 'brand/mirqam-logo-512.png'), await png(512))

// Data URIs: a page opened with setContent() cannot load file:// resources.
const font = (w) => `data:font/woff2;base64,${readFileSync(join(PUBLIC, `blog/plex-${w}.woff2`)).toString('base64')}`
const wordmark = `data:image/svg+xml;base64,${Buffer.from(wordmarkSvg).toString('base64')}`
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@font-face { font-family: Plex; font-weight: 400; src: url(${font(400)}) format('woff2'); }
@font-face { font-family: Plex; font-weight: 700; src: url(${font(700)}) format('woff2'); }
html, body { margin: 0; width: 1200px; height: 630px; }
body { background: #172740; color: #fff; font-family: Plex, sans-serif; display: flex; flex-direction: column; justify-content: center; padding: 0 96px; box-sizing: border-box; }
img { width: 190px; height: auto; margin-bottom: 40px; }
h1 { font-size: 80px; font-weight: 700; margin: 0; line-height: 1.25; }
p { font-size: 40px; margin: 18px 0 0; color: #c9d3e3; line-height: 1.5; }
.wallets { font-size: 30px; margin-top: 14px; color: #8fd3d6; }
.bar { position: absolute; inset-inline: 0; bottom: 0; height: 14px; background: #17949a; }
.url { position: absolute; bottom: 52px; inset-inline-start: 96px; font-size: 28px; color: #8fd3d6; direction: ltr; }
</style></head><body>
<img src="${wordmark}" alt="">
<h1>مرقام نقاط</h1>
<p>بطاقات نقاط وأختام وهدايا في محفظة جوال عميلك</p>
<p class="wallets"><span dir="ltr">Apple Wallet · Google Wallet</span></p>
<span class="url">loyalty.mirqam.sa</span><div class="bar"></div>
</body></html>`

const { chromium } = createRequire(import.meta.url)('playwright')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'load' })
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].filter((f) => f.status === 'loaded').length
  })
  if (loaded !== 2) throw new Error(`IBM Plex Sans Arabic did not load (${loaded}/2 faces)`)
  writeFileSync(
    join(PUBLIC, 'og-image.png'),
    await sharp(await page.screenshot({ type: 'png' }))
      .png({ compressionLevel: 9 })
      .toBuffer(),
  )
} finally {
  await browser.close()
}
console.log('wrote favicon.svg, favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png, brand/mirqam-logo-512.png, og-image.png')
