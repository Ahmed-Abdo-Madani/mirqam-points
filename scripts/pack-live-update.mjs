#!/usr/bin/env node
/* Packs the mobile web build (apps/web/dist-mobile) as a live update for the
   Points Business app (@capgo/capacitor-updater, self-hosted):
     apps/web/dist/live-update/points-<id>.zip   the screens (no source maps)
     apps/web/dist/live-update/manifest.json     id, SHA-256, size, minNative
   The API serves both (apps/api/src/live-update.js). The zip is deterministic
   (sorted names, fixed dates), so an unchanged app keeps the same id and
   phones download nothing after a redeploy.
   Run after `npm run build` and `npm run build:mobile -w @mirqam-points/web`. */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'apps', 'web', 'dist-mobile')
const OUT = join(ROOT, 'apps', 'web', 'dist', 'live-update')
const { minNative } = JSON.parse(readFileSync(join(ROOT, 'apps', 'mobile', 'live-update.json'), 'utf8'))

if (!existsSync(join(SRC, 'index.html'))) {
  console.error('[live-update] apps/web/dist-mobile/index.html is missing — build the mobile web app first')
  process.exit(1)
}

// Only a native-mode build may reach the app (VITE_NATIVE / VITE_API_BASE from
// apps/web/.env.mobile); a website build would call the wrong API address.
const apiBase = /^VITE_API_BASE=(.+)$/m.exec(readFileSync(join(ROOT, 'apps', 'web', '.env.mobile'), 'utf8'))?.[1]?.trim()
const indexJs = readdirSync(join(SRC, 'assets')).filter((f) => /^index-.*\.js$/.test(f))
if (!apiBase || !indexJs.some((f) => readFileSync(join(SRC, 'assets', f), 'utf8').includes(apiBase))) {
  console.error('[live-update] dist-mobile is not a native build (API address missing) — refusing to publish it')
  process.exit(1)
}

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : [path]
    })
}

/** Minimal zip writer (deflate, fixed 1980-01-01 timestamps). */
export function zip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const packed = deflateRawSync(data, { level: 9 })
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0x21, 12) // date 1980-01-01
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, packed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + packed.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

const files = walk(SRC)
  // Source maps and the Android download (/downloads) never ship to the app.
  .filter((p) => !p.endsWith('.map') && !relative(SRC, p).startsWith(`downloads${sep}`))
  .map((p) => ({ name: relative(SRC, p).split(sep).join('/'), data: readFileSync(p) }))
const bundle = zip(files)
const checksum = createHash('sha256').update(bundle).digest('hex')
const id = checksum.slice(0, 12)
const file = `points-${id}.zip`

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, file), bundle)
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify({ id, checksum, size: bundle.length, file, minNative, files: files.length }, null, 2)}\n`)
console.log(`[live-update] ${file}: ${files.length} files, ${(bundle.length / 1024).toFixed(0)} KB, for app ${minNative}+`)
