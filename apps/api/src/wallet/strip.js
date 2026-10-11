/* Stamp-strip artwork for wallet cards, rasterised here (no image library):
   a grid of shapes, the first `filled` in the stamp colour and the rest faded.
   Output is a transparent-background PNG so the card colour shows through. */
import { crc32, deflateSync } from 'node:zlib'

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

/* Each test takes a point relative to the shape centre, scaled so the shape spans [-1, 1]. */
const INSIDE = {
  circle: (x, y) => x * x + y * y <= 1,
  square: (x, y) =>
    Math.abs(x) <= 0.86 && Math.abs(y) <= 0.86 && (Math.abs(x) < 0.5 || Math.abs(y) < 0.5 || (Math.abs(x) - 0.5) ** 2 + (Math.abs(y) - 0.5) ** 2 <= 0.36 ** 2),
  heart: (x, y) => {
    const hx = x * 1.25
    const hy = -y * 1.25 + 0.15
    return (hx * hx + hy * hy - 1) ** 3 - hx * hx * hy ** 3 <= 0
  },
  star: (x, y) => {
    // Point-in-polygon against a 5-point star (outer 1, inner 0.42).
    const pts = []
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 1 : 0.42
      const a = (Math.PI / 5) * i - Math.PI / 2
      pts.push([Math.cos(a) * r, Math.sin(a) * r])
    }
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]
      const [xj, yj] = pts[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  },
}

export function hexToRgb(hex) {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
}

/** Grid layout: one row up to 6 stamps, otherwise the fewest rows of at most 7. */
export function stripLayout(count) {
  const rows = count <= 6 ? 1 : Math.ceil(count / 7)
  return { rows, perRow: Math.ceil(count / rows) }
}

export function renderStrip({ width, height, total, filled, shape = 'circle', color = '#8ac0c4' }) {
  const n = clamp(Math.floor(total) || 1, 1, 21)
  const done = clamp(Math.floor(filled) || 0, 0, n)
  const test = INSIDE[shape] ?? INSIDE.circle
  const [r, g, b] = hexToRgb(color)
  const { rows, perRow } = stripLayout(n)
  const cellW = width / perRow
  const cellH = height / rows
  const radius = Math.min(cellW, cellH) * 0.36
  const px = Buffer.alloc(width * height * 4)
  const SS = 4
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow)
    const inRow = row === rows - 1 ? n - row * perRow : perRow
    const col = i - row * perRow
    const cx = (width - inRow * cellW) / 2 + (col + 0.5) * cellW
    const cy = (row + 0.5) * cellH
    const alpha = i < done ? 255 : 70
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        let hit = 0
        for (let sy = 0; sy < SS; sy++)
          for (let sx = 0; sx < SS; sx++) if (test((x + (sx + 0.5) / SS - cx) / radius, (y + (sy + 0.5) / SS - cy) / radius)) hit++
        if (!hit) continue
        const o = (y * width + x) * 4
        px[o] = r
        px[o + 1] = g
        px[o + 2] = b
        px[o + 3] = Math.round((alpha * hit) / (SS * SS))
      }
    }
  }
  return encodePng(width, height, px)
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Validates an uploaded merchant logo (PNG only, bounded) and returns its dimensions. */
export function inspectLogo(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buf.length < 33 || !buf.subarray(0, 8).equals(sig) || buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  if (width < 48 || height < 48 || width > 1024 || height > 1024) return null
  return { width, height }
}
