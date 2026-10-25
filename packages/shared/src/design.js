/* Wallet-card design: the single description of what a merchant may customise.
   The API validates and normalises with it, the console edits it, and both
   wallet renderers (and the in-app preview) read the normalised result. */

export const LAYOUTS = ['classic', 'strip', 'balance']
export const BARCODES = ['qr', 'pdf417', 'aztec', 'code128']
export const STAMP_SHAPES = ['circle', 'star', 'heart', 'square']
/* What the member sees on the card face (max 3) and in the details section. */
export const FRONT_FIELDS = ['member', 'remaining', 'lifetime', 'code']
export const BACK_FIELDS = ['code', 'reward', 'terms', 'link']
export const MAX_NOTES = 6
/* Branch locations: shown on the back of the card as Google Maps links, and on
   Apple Wallet used for "nearby" lock-screen notices (Wallet allows 10). */
export const MAX_LOCATIONS = 10
export const DEFAULT_NEARBY_TEXT = 'زرنا اليوم، اشتقنا لك! 💚'

export const DEFAULT_DESIGN = {
  layout: 'classic',
  background: '#172740',
  foreground: '#ffffff',
  label: '#8ac0c4',
  stampColor: '#8ac0c4',
  stampShape: 'circle',
  barcode: 'qr',
  front: ['member'],
  back: ['code', 'reward', 'terms', 'link'],
  notes: [],
  locations: [],
  nearby: false,
  nearbyText: '',
}

/* Starting points the merchant can then tweak. */
export const TEMPLATES = [
  {
    id: 'navy',
    layout: 'classic',
    background: '#172740',
    foreground: '#ffffff',
    label: '#8ac0c4',
    stampColor: '#8ac0c4',
    stampShape: 'circle',
    stampsOnly: false,
  },
  {
    id: 'coffee',
    layout: 'strip',
    background: '#fbf4ea',
    foreground: '#3b2418',
    label: '#8a6a52',
    stampColor: '#6b3f27',
    stampShape: 'circle',
    stampsOnly: true,
  },
  {
    id: 'paper',
    layout: 'balance',
    background: '#ffffff',
    foreground: '#172740',
    label: '#5b6b82',
    stampColor: '#0f6f74',
    stampShape: 'circle',
    stampsOnly: false,
  },
  {
    id: 'teal',
    layout: 'classic',
    background: '#0f6f74',
    foreground: '#ffffff',
    label: '#bfe6e8',
    stampColor: '#ffffff',
    stampShape: 'star',
    stampsOnly: false,
  },
  { id: 'gold', layout: 'strip', background: '#1c1c1e', foreground: '#f5e6c4', label: '#c9a85c', stampColor: '#c9a85c', stampShape: 'star', stampsOnly: true },
  {
    id: 'rose',
    layout: 'balance',
    background: '#fdecef',
    foreground: '#7a1f3d',
    label: '#b4506f',
    stampColor: '#d6336c',
    stampShape: 'heart',
    stampsOnly: false,
  },
]

const HEX = /^#[0-9a-fA-F]{6}$/
const pick = (list, v, fallback) => (list.includes(v) ? v : fallback)
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v, min, max) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 1e6) / 1e6 : null
}

/** Google Maps link for a branch: the merchant's own maps link when given, else one built from the coordinates. */
export function mapsUrl(loc) {
  if (typeof loc?.mapsUrl === 'string' && /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)\S*$/i.test(loc.mapsUrl)) return loc.mapsUrl
  return `https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`
}

/** Reads coordinates out of a pasted Google Maps link (…/@lat,lng…, ?q=lat,lng, !3dlat!4dlng). Null when absent (e.g. short links). */
export function coordsFromMapsUrl(url) {
  const s = String(url || '')
  const m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(s) || /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(s) || /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(s)
  if (!m) return null
  const latitude = num(m[1], -90, 90)
  const longitude = num(m[2], -180, 180)
  return latitude === null || longitude === null ? null : { latitude, longitude }
}

const subset = (list, raw, max, fallback) => {
  if (!Array.isArray(raw)) return fallback
  return [...new Set(raw.filter((v) => list.includes(v)))].slice(0, max)
}

export function normalizeDesign(raw = {}) {
  const d = { ...DEFAULT_DESIGN, front: [...DEFAULT_DESIGN.front], back: [...DEFAULT_DESIGN.back], notes: [] }
  for (const k of ['background', 'foreground', 'label', 'stampColor']) if (HEX.test(raw?.[k] ?? '')) d[k] = raw[k].toLowerCase()
  // Cards designed before stamp colours existed keep their accent.
  if (!HEX.test(raw?.stampColor ?? '')) d.stampColor = d.label
  d.layout = pick(LAYOUTS, raw?.layout, d.layout)
  d.stampShape = pick(STAMP_SHAPES, raw?.stampShape, d.stampShape)
  d.barcode = pick(BARCODES, raw?.barcode, d.barcode)
  d.front = subset(FRONT_FIELDS, raw?.front, 3, d.front)
  d.back = subset(BACK_FIELDS, raw?.back, BACK_FIELDS.length, d.back)
  if (Array.isArray(raw?.notes)) {
    d.notes = raw.notes
      .map((n) => ({ label: text(n?.label, 40), value: text(n?.value, 400) }))
      .filter((n) => n.label && n.value)
      .slice(0, MAX_NOTES)
  }
  if (Array.isArray(raw?.locations)) {
    d.locations = raw.locations
      .map((l) => {
        const fromUrl = coordsFromMapsUrl(l?.mapsUrl)
        const latitude = num(l?.latitude, -90, 90) ?? fromUrl?.latitude ?? null
        const longitude = num(l?.longitude, -180, 180) ?? fromUrl?.longitude ?? null
        const url = text(l?.mapsUrl, 500)
        return { name: text(l?.name, 40), latitude, longitude, ...(url ? { mapsUrl: url } : {}) }
      })
      .filter((l) => l.name && l.latitude !== null && l.longitude !== null)
      .slice(0, MAX_LOCATIONS)
  }
  d.nearby = raw?.nearby === true && d.locations.length > 0
  d.nearbyText = text(raw?.nearbyText, 100)
  const reward = text(raw?.rewardText, 140)
  if (reward) d.rewardText = reward
  return d
}
