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

/* Points app icon: white Mirqam wordmark on navy over a row of teal
   qaf-diamonds (the loyalty-stamp motif). Distinct from Mirqam Bot's
   WhatsApp-bubble icon, same brand system. Built once at 1024 and scaled. */
async function pointsIcon() {
  const mark = await sharp(wordmarkWhite, { density: 144 })
    .resize(700, 420, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const diamonds = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="90" viewBox="0 0 560 90">${[0, 1, 2, 3, 4]
      .map(
        (i) =>
          `<rect x="${i * 110 + 22}" y="17" width="56" height="56" rx="10" transform="rotate(45 ${i * 110 + 50} 45)" fill="${i < 4 ? '#23949a' : 'none'}" stroke="#54a8ad" stroke-width="6"/>`,
      )
      .join('')}</svg>`,
  )
  return sharp({ create: { width: 1024, height: 1024, channels: 4, background: NAVY } })
    .composite([
      { input: mark, top: 190, left: 162 },
      { input: await sharp(diamonds).png().toBuffer(), top: 700, left: 232 },
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
