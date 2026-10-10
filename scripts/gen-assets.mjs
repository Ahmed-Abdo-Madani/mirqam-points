#!/usr/bin/env node
/* Renders raster brand assets from the SVG sources (run after changing a logo):
   - apps/api/assets/pass/*.png    Apple Wallet pass icon + logo (white wordmark on dark passes)
   - apps/web/public/brand/pass-logo.png   Google Wallet programLogo (square, public URL)
   - apps/mobile/assets/icon.png, splash.png   source images for native app icons/splash
   Usage: node scripts/gen-assets.mjs */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const brand = (f) => readFileSync(join(ROOT, 'apps/web/public/brand', f))
const out = (rel) => {
  const p = join(ROOT, rel)
  mkdirSync(dirname(p), { recursive: true })
  return p
}
const NAVY = '#172740'

const wordmarkWhite = brand('mirqam-dark.svg')

/* Points app icon — the Mirqam family pattern (same as the live «مرقام تسويق»
   app): white wordmark on navy with the product name beneath it.
   Tahoma Bold renders the Arabic label with correct joining and dots via
   librsvg; built once at 1024 and scaled down. */
async function pointsIcon() {
  const mark = await sharp(wordmarkWhite, { density: 144 })
    .resize(720, 470, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const label = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="200"><text x="512" y="150" font-family="Tahoma" font-weight="700" font-size="150" fill="#ffffff" text-anchor="middle">نقاط</text></svg>',
  )
  return sharp({ create: { width: 1024, height: 1024, channels: 4, background: NAVY } })
    .composite([
      { input: mark, top: 150, left: 152 },
      { input: await sharp(label).png().toBuffer(), top: 640, left: 0 },
    ])
    .png()
    .toBuffer()
}
const appIcon = await pointsIcon()

// Apple pass icon (shown in notifications / lock screen): square app icon.
for (const [name, size] of [
  ['icon.png', 29],
  ['icon@2x.png', 58],
  ['icon@3x.png', 87],
]) {
  await sharp(appIcon)
    .resize(size, size)
    .png()
    .toFile(out(`apps/api/assets/pass/${name}`))
}

// Apple pass logo: white wordmark, transparent, max 160x50 @1x.
for (const [name, w, h] of [
  ['logo.png', 160, 50],
  ['logo@2x.png', 320, 100],
  ['logo@3x.png', 480, 150],
]) {
  await sharp(wordmarkWhite, { density: 144 })
    .resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out(`apps/api/assets/pass/${name}`))
}

// Google Wallet program logo: square, opaque.
await sharp(appIcon).resize(660, 660).flatten({ background: NAVY }).png().toFile(out('apps/web/public/brand/pass-logo.png'))

// Native app sources for @capacitor/assets.
await sharp(appIcon).resize(1024, 1024).flatten({ background: NAVY }).png().toFile(out('apps/mobile/assets/icon-only.png'))
await sharp(appIcon).resize(1024, 1024).flatten({ background: NAVY }).png().toFile(out('apps/mobile/assets/icon-foreground.png'))
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: NAVY } })
  .png()
  .toFile(out('apps/mobile/assets/icon-background.png'))
const mark = await sharp(wordmarkWhite, { density: 144 })
  .resize(1100, 500, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer()
await sharp({ create: { width: 2732, height: 2732, channels: 4, background: NAVY } })
  .composite([{ input: mark, gravity: 'center' }])
  .png()
  .toFile(out('apps/mobile/assets/splash.png'))
await sharp({ create: { width: 2732, height: 2732, channels: 4, background: NAVY } })
  .composite([{ input: mark, gravity: 'center' }])
  .png()
  .toFile(out('apps/mobile/assets/splash-dark.png'))

console.log('assets generated')
