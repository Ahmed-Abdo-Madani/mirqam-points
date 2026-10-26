import QRCode from 'qrcode'

const qrMatrix = (text) => {
  const m = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules
  return Array.from({ length: m.size }, (_, r) => Array.from({ length: m.size }, (_, c) => Boolean(m.get(r, c))))
}

const luminance = (hex) => {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  if (!Number.isFinite(n)) return 1
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0)
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Shrinks a line until it fits the poster width. */
function fitText(ctx, text, weight, size, family, maxWidth) {
  let s = size
  do {
    ctx.font = `${weight} ${s}px ${family}`
    s -= 2
  } while (ctx.measureText(text).width > maxWidth && s > 18)
}

/**
 * Join-QR poster in the program's card colours, downloaded as a PNG ready to
 * print and place at the counter or on tables. The QR stays dark-on-white so
 * every phone camera reads it.
 */
export async function downloadJoinPoster(opts) {
  const W = 1200
  const H = 1600
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  await document.fonts?.ready?.catch(() => undefined)
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
  const { background, foreground, label } = opts.colors

  ctx.fillStyle = background
  ctx.fillRect(0, 0, W, H)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.direction = 'rtl'

  ctx.fillStyle = foreground
  fitText(ctx, opts.merchant, 800, 76, family, W - 160)
  ctx.fillText(opts.merchant, W / 2, 170)
  ctx.fillStyle = label
  fitText(ctx, opts.programName, 600, 50, family, W - 160)
  ctx.fillText(opts.programName, W / 2, 262)

  // White tile with the QR; modules in the card colour when it is dark enough.
  const tile = 820
  const tx = (W - tile) / 2
  const ty = 350
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, tx, ty, tile, tile, 56)
  ctx.fill()
  const matrix = qrMatrix(opts.url, 'M')
  const n = matrix.length
  const quiet = 4
  const cell = Math.floor((tile - 80) / (n + quiet * 2))
  const qrSize = cell * (n + quiet * 2)
  const qx = tx + (tile - qrSize) / 2 + quiet * cell
  const qy = ty + (tile - qrSize) / 2 + quiet * cell
  ctx.fillStyle = luminance(background) < 0.25 ? background : '#111827'
  matrix.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) ctx.fillRect(qx + c * cell, qy + r * cell, cell, cell)
    }),
  )

  ctx.fillStyle = foreground
  fitText(ctx, opts.scanText, 700, 52, family, W - 160)
  ctx.fillText(opts.scanText, W / 2, ty + tile + 120)
  ctx.fillStyle = label
  ctx.font = `500 30px ${family}`
  ctx.direction = 'ltr'
  ctx.fillText(opts.url.replace(/^https?:\/\//, '').replace(/\/[^/]+$/, '/…'), W / 2, H - 90)

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('could not create image')
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = opts.fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}
