/* A4 documents to PDF in the browser, identical to the print view.
   Each `.doc-page` (exactly 210mm x 297mm, margins inside it) is drawn by the browser's
   own engine through an SVG <foreignObject>, so Arabic shaping, fonts, colours and the
   stamp are what print shows. The pages become JPEG images in a minimal PDF; nothing is
   uploaded and no server renderer is needed. If drawing is not possible (an old
   WebView, a tainted canvas), the calls reject and the caller falls back to printing. */

export const A4_PT = { width: 595.28, height: 841.89 }

const textBytes = (s) => new TextEncoder().encode(s)

/* PDF strings: UTF-16BE with a BOM, hex-encoded, so Arabic titles survive. */
function pdfString(s) {
  let hex = 'FEFF'
  for (const ch of String(s)) {
    const code = ch.codePointAt(0)
    if (code > 0xffff) {
      const v = code - 0x10000
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0')
    } else hex += code.toString(16).padStart(4, '0')
  }
  return `<${hex.toUpperCase()}>`
}

/** Minimal PDF 1.4: one A4 page per JPEG image ({ bytes, width, height }), scaled to the full page. */
export function buildPdf(images, { title = '' } = {}) {
  if (!images.length) throw new Error('no pages')
  const parts = []
  const offsets = []
  let length = 0
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? textBytes(chunk) : chunk
    parts.push(bytes)
    length += bytes.length
  }
  const object = (n, ...body) => {
    offsets[n] = length
    push(`${n} 0 obj\n`)
    for (const chunk of body) push(chunk)
    push('\nendobj\n')
  }
  push('%PDF-1.4\n')
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  const first = 4
  const total = first + images.length * 3
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Count ${images.length} /Kids [${images.map((_, i) => `${first + i * 3} 0 R`).join(' ')}] >>`)
  object(3, `<< /Producer (Mirqam) ${title ? `/Title ${pdfString(title)} ` : ''}>>`)
  images.forEach((img, i) => {
    const page = first + i * 3
    const draw = `q ${A4_PT.width} 0 0 ${A4_PT.height} 0 0 cm /P${i} Do Q`
    object(
      page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_PT.width} ${A4_PT.height}] /Resources << /XObject << /P${i} ${page + 1} 0 R >> >> /Contents ${page + 2} 0 R >>`,
    )
    object(
      page + 1,
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`,
      img.bytes,
      '\nendstream',
    )
    object(page + 2, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`)
  })
  const xref = length
  push(`xref\n0 ${total}\n0000000000 65535 f \n`)
  for (let n = 1; n < total; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(length)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

async function toDataUrl(url) {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`asset ${res.status}`)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/* Every url(...) in the CSS (fonts, images) becomes a data: URL, because an SVG drawn as
   an image cannot load anything. A woff fallback after a woff2 source is never used by a
   browser that can draw this, so it is dropped instead of being downloaded. */
async function inlineUrls(css, base) {
  const lean = css.replace(/,\s*url\(\s*(['"]?)[^'")]+\.woff\1\s*\)\s*format\(\s*['"]?woff['"]?\s*\)/g, '')
  const found = [...new Set([...lean.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[0]))]
  let out = lean
  for (const token of found) {
    const target = token.match(/url\(\s*(['"]?)([^'")]+)\1\s*\)/)[2]
    if (target.startsWith('data:')) continue
    out = out.split(token).join(`url("${await toDataUrl(new URL(target, base).href)}")`)
  }
  return out
}

/** The document's CSS: <style>/<link> elements marked data-doc-css (all stylesheets when none is marked). */
export async function documentCss(root = document) {
  let nodes = [...root.querySelectorAll('link[rel=stylesheet][data-doc-css],style[data-doc-css]')]
  if (!nodes.length) nodes = [...root.querySelectorAll('link[rel=stylesheet],style')]
  const chunks = []
  for (const node of nodes) {
    if (node.tagName === 'STYLE') chunks.push(await inlineUrls(node.textContent, window.location.href))
    else {
      const res = await fetch(node.href, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`css ${res.status}`)
      chunks.push(await inlineUrls(await res.text(), node.href))
    }
  }
  return chunks.join('\n')
}

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 30))
const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
// The SVG is parsed as XML: CSS text needs its & and < escaped.
const xmlText = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')

async function pageToJpeg(page, css, scale, quality) {
  const width = page.offsetWidth
  const height = page.offsetHeight
  const clone = page.cloneNode(true)
  for (const img of clone.querySelectorAll('img[src]')) {
    if (!img.getAttribute('src').startsWith('data:')) img.setAttribute('src', await toDataUrl(img.src))
  }
  // The page is drawn inside a copy of its .mq-doc wrapper, so the scoped rules, the
  // direction and the status attributes apply exactly as on screen.
  const doc = page.closest('.mq-doc')
  const attrs = ['dir', 'lang', 'data-status']
    .map((name) => [name, doc?.getAttribute(name) ?? (name === 'dir' ? document.documentElement.dir || 'rtl' : null)])
    .filter(([, value]) => value != null)
    .map(([name, value]) => ` ${name}="${escAttr(value)}"`)
    .join('')
  const xhtml = new XMLSerializer().serializeToString(clone)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" class="mq-doc doc-raster"${attrs} style="margin:0;padding:0"><style>${xmlText(css)}\n.doc-raster .doc-page{margin:0!important;box-shadow:none!important;transform:none!important}</style>${xhtml}</div></foreignObject></svg>`
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const g = canvas.getContext('2d')
  // Drawn twice: WebKit may paint an SVG's fonts only from the second draw.
  for (let i = 0; i < 2; i++) {
    g.fillStyle = '#fff'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.drawImage(img, 0, 0, canvas.width, canvas.height)
    if (!i) await nextFrame()
  }
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/jpeg', quality))
  const bytes = new Uint8Array(await blob.arrayBuffer())
  canvas.width = 0
  canvas.height = 0
  return { bytes, width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Draws the given `.doc-page` elements into a PDF and returns its bytes. */
export async function renderPdf(pages, { scale = 3, quality = 0.92, title = '' } = {}) {
  if (document.fonts?.ready) await document.fonts.ready
  const css = await documentCss()
  const images = []
  for (const page of pages) images.push(await pageToJpeg(page, css, scale, quality))
  return buildPdf(images, { title })
}

export function saveBytes(bytes, filename, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/** Renders every `.doc-page` on the screen into `filename`. Rejects when the browser cannot draw it. */
export async function downloadPdf({ pages = document.querySelectorAll('.mq-doc .doc-page'), filename = 'document.pdf', title = '', ...opts } = {}) {
  const bytes = await renderPdf([...pages], { title, ...opts })
  saveBytes(bytes, filename)
  return bytes
}

/** Prints once the document fonts are ready (else the first print can use a fallback font). */
export async function printDocument() {
  if (document.fonts?.ready) await document.fonts.ready
  window.print()
}
