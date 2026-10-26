/* Stamp-strip artwork for wallet cards, rasterised here (no image library):
   a grid of shapes, the first `filled` in the stamp colour and the rest faded.
   Output is a transparent-background PNG so the card colour shows through. */
import { crc32, deflateSync, inflateSync } from 'node:zlib'

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

/** Draws a merchant stamp image (decoded RGBA) centred in a cell, faded when not yet earned. */
function drawImage(px, width, height, img, cx, cy, size, alpha) {
  const scale = Math.min(size / img.width, size / img.height)
  const w = img.width * scale
  const h = img.height * scale
  const x0 = Math.round(cx - w / 2)
  const y0 = Math.round(cy - h / 2)
  const SS = 2
  for (let y = Math.max(0, y0); y < Math.min(height, y0 + Math.ceil(h)); y++) {
    for (let x = Math.max(0, x0); x < Math.min(width, x0 + Math.ceil(w)); x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const ix = clamp(Math.floor((x - x0 + (sx + 0.5) / SS) / scale), 0, img.width - 1)
          const iy = clamp(Math.floor((y - y0 + (sy + 0.5) / SS) / scale), 0, img.height - 1)
          const o = (iy * img.width + ix) * 4
          const pa = img.rgba[o + 3]
          r += img.rgba[o] * pa
          g += img.rgba[o + 1] * pa
          b += img.rgba[o + 2] * pa
          a += pa
        }
      if (!a) continue
      const o = (y * width + x) * 4
      px[o] = Math.round(r / a)
      px[o + 1] = Math.round(g / a)
      px[o + 2] = Math.round(b / a)
      px[o + 3] = Math.round(((a / (SS * SS)) * alpha) / 255)
    }
  }
}

export function renderStrip({ width, height, total, filled, shape = 'circle', color = '#8ac0c4', image = null }) {
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
    if (shape === 'custom' && image) {
      drawImage(px, width, height, image, cx, cy, radius * 2.3, alpha)
      continue
    }
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

/** Decodes a non-interlaced PNG (greyscale, RGB, palette, grey+alpha, RGBA; palette 1–8 bit, others 8 bit)
    into { width, height, rgba }. Null when the file is anything else. */
export function decodePng(buf) {
  try {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    if (!Buffer.isBuffer(buf) || buf.length < 45 || !buf.subarray(0, 8).equals(sig)) return null
    let i = 8
    let ihdr = null
    let palette = null
    let trns = null
    const idat = []
    while (i + 8 <= buf.length) {
      const len = buf.readUInt32BE(i)
      const type = buf.toString('ascii', i + 4, i + 8)
      const data = buf.subarray(i + 8, i + 8 + len)
      if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] }
      else if (type === 'PLTE') palette = data
      else if (type === 'tRNS') trns = data
      else if (type === 'IDAT') idat.push(data)
      else if (type === 'IEND') break
      i += 12 + len
    }
    if (!ihdr || ihdr.interlace !== 0 || ihdr.width < 1 || ihdr.height < 1 || ihdr.width > 1024 || ihdr.height > 1024) return null
    const { width, height, depth, color } = ihdr
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color]
    if (!channels || (color === 3 ? ![1, 2, 4, 8].includes(depth) : depth !== 8) || (color === 3 && !palette)) return null
    const raw = inflateSync(Buffer.concat(idat))
    const bpp = Math.max(1, (channels * depth) / 8)
    const stride = Math.ceil((width * channels * depth) / 8)
    if (raw.length < (stride + 1) * height) return null
    const out = Buffer.alloc(stride * height)
    for (let y = 0; y < height; y++) {
      const f = raw[y * (stride + 1)]
      const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? out[y * stride + x - bpp] : 0
        const b = y > 0 ? out[(y - 1) * stride + x] : 0
        const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0
        out[y * stride + x] = (line[x] + pred) & 255
      }
    }
    const rgba = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4
        const row = y * stride
        if (color === 3) {
          const bit = x * depth
          const idx = (out[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
          rgba[o] = palette[idx * 3] ?? 0
          rgba[o + 1] = palette[idx * 3 + 1] ?? 0
          rgba[o + 2] = palette[idx * 3 + 2] ?? 0
          rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255
        } else {
          const s = row + x * channels
          const grey = color === 0 || color === 4
          rgba[o] = out[s]
          rgba[o + 1] = grey ? out[s] : out[s + 1]
          rgba[o + 2] = grey ? out[s] : out[s + 2]
          rgba[o + 3] = color === 4 ? out[s + 1] : color === 6 ? out[s + 3] : 255
        }
      }
    return { width, height, rgba }
  } catch {
    return null
  }
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
