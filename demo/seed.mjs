#!/usr/bin/env node
/* Mirqam Loyalty (Mirqam Points) — DEMO seed. Lives on the `demo` branch only.

   Fills the demo container's private Postgres with a busy Jeddah specialty-coffee
   chain, "بُنّ الحجاز": three branches, a points programme, a stamp card, an archived
   seasonal card, ~360 members with Arabic names and fake Saudi numbers (+96650000XXXX),
   five months of visits (dense over the last 60 days) with earns, reward redemptions,
   manager adjustments and voids, campaigns with their bonus-point results, gift cards,
   staff of every role and an active yearly subscription.

   Safety
   - Refuses to run unless MIRQAM_DEMO=1 and DATABASE_URL points at a loopback Postgres
     (the container's own database). Never point it at anything else.
   - Idempotent: every run empties the app tables (TRUNCATE — the ledger's append-only
     trigger is row-level, TRUNCATE does not touch posted history row by row) and writes
     the same deterministic data again (seeded PRNG), dated relative to "now".
   - The ledger is written directly (history needs past timestamps), and the run ends
     with the engine's own reconcile(): every cached balance must equal SUM(ledger).

   Env: DATABASE_URL, SECRET_KEY (the app's key: gift-card codes are sealed with it),
        DEMO_PASSWORD (optional; overrides the shared demo password below). */
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword } from '../apps/api/src/auth.js'
import { openDb } from '../apps/api/src/db/index.js'
import { migrate } from '../apps/api/src/db/migrate.js'
import { reconcile } from '../apps/api/src/ledger.js'
import { seal, sha256 } from '../apps/api/src/secrets.js'
import { computeEarn, normalizeDesign, validateProgramConfig } from '../packages/shared/src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

if (process.env.MIRQAM_DEMO !== '1') {
  console.error('[demo-seed] refusing to run: MIRQAM_DEMO=1 is not set')
  process.exit(1)
}
const DATABASE_URL = process.env.DATABASE_URL || ''
let dbHost = ''
try {
  dbHost = new URL(DATABASE_URL).hostname
} catch {}
if (!/^postgres(ql)?:\/\//.test(DATABASE_URL) || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(dbHost)) {
  console.error('[demo-seed] refusing to run: DATABASE_URL must be the local demo Postgres (127.0.0.1)')
  process.exit(1)
}
const SECRET_KEY = process.env.SECRET_KEY
if (!SECRET_KEY) {
  console.error('[demo-seed] refusing to run: SECRET_KEY is not set (the app needs the same key to read gift-card codes)')
  process.exit(1)
}
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo-hdIWMqSiCC-26'

// ------------------------------------------------------------------ deterministic randomness
function mulberry32(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(20261029)
const rand = () => rng()
const between = (min, max) => min + Math.floor(rand() * (max - min + 1))
const pick = (list) => list[Math.floor(rand() * list.length)]
const chance = (p) => rand() < p
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0)
  let r = rand() * total
  for (const [v, w] of pairs) {
    r -= w
    if (r < 0) return v
  }
  return pairs[pairs.length - 1][0]
}
const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rand() * 16)]).join('')
function uuid() {
  const h = hex(32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[Math.floor(rand() * 4)]}${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const crock = (n) => Array.from({ length: n }, () => CROCKFORD[Math.floor(rand() * 32)]).join('')
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const token = (n) => Array.from({ length: n }, () => B64URL[Math.floor(rand() * 64)]).join('')

// ------------------------------------------------------------------ time (Asia/Riyadh, UTC+3, no DST)
const MIN = 60_000
const DAY = 86_400_000
const RIYADH = 3 * 3_600_000
const NOW = Date.now()
const TODAY = Math.floor((NOW + RIYADH) / DAY) * DAY - RIYADH // Riyadh midnight today, as UTC ms
/** daysAgo + minute of the (Riyadh) day → Date. */
const at = (daysAgo, minute) => new Date(TODAY - daysAgo * DAY + Math.round(minute * MIN))
/** 0 = Sunday … 4 = Thursday, 5 = Friday, 6 = Saturday (Riyadh calendar). */
const weekday = (daysAgo) => new Date(TODAY - daysAgo * DAY + RIYADH).getUTCDay()
const LATEST = NOW - 3 * MIN // nothing is dated in the future

// ------------------------------------------------------------------ the business
const SLUG = 'bunn-alhijaz'
const TENANT_NAME = 'بُنّ الحجاز'
const LAUNCH = 150 // programme launched 150 days ago
const DEMO_DOMAIN = 'loyalty.demo.mirqam.sa'

const BRANCHES = [
  { key: 'rwd', code: 'RWD', name: 'فرع الروضة', latitude: 21.5655, longitude: 39.153, opensAgo: LAUNCH, weight: 0.42, invoice: 41200 },
  { key: 'sht', code: 'SHT', name: 'فرع الشاطئ', latitude: 21.5905, longitude: 39.108, opensAgo: LAUNCH, weight: 0.36, invoice: 38650 },
  { key: 'obh', code: 'OBH', name: 'فرع أبحر الشمالية', latitude: 21.7465, longitude: 39.112, opensAgo: 45, weight: 0.22, invoice: 10010 },
]
const branchByKey = Object.fromEntries(BRANCHES.map((b) => [b.key, b]))

const STAFF = [
  { key: 'owner', email: `owner@${DEMO_DOMAIN}`, name: 'فيصل الغامدي', role: 'owner', joinedAgo: 152 },
  { key: 'manager', email: `manager@${DEMO_DOMAIN}`, name: 'هند الزهراني', role: 'manager', joinedAgo: 151 },
  { key: 'rwd', email: `cashier@${DEMO_DOMAIN}`, name: 'ياسر الحربي', role: 'cashier', joinedAgo: 150 },
  { key: 'sht', email: `cashier.shati@${DEMO_DOMAIN}`, name: 'رهف القرشي', role: 'cashier', joinedAgo: 149 },
  { key: 'obh', email: `cashier.obhur@${DEMO_DOMAIN}`, name: 'مازن باعشن', role: 'cashier', joinedAgo: 47 },
  { key: 'analyst', email: `analyst@${DEMO_DOMAIN}`, name: 'لمى الجهني', role: 'analyst', joinedAgo: 90 },
]

const REWARDS = [
  { name: 'قهوة اليوم', cost: 120, w: 6 },
  { name: 'كرواسون زبدة', cost: 150, w: 4 },
  { name: 'لاتيه مثلّج', cost: 180, w: 5 },
  { name: 'V60 مختصة', cost: 220, w: 3 },
  { name: 'قطعة كيك', cost: 260, w: 3 },
  { name: 'كيس بُن 250 غ', cost: 450, w: 1.2 },
  { name: 'كوب حراري بشعار بُنّ الحجاز', cost: 600, w: 0.8 },
]

const MENU = [
  [1200, 3], // إسبريسو
  [1400, 5], // أمريكانو
  [1800, 5], // كابتشينو
  [1900, 4], // فلات وايت
  [2100, 7], // لاتيه
  [2200, 7], // سبانش لاتيه
  [2100, 6], // آيس لاتيه
  [2000, 4], // كولد برو
  [2200, 4], // V60
  [1500, 2], // شاي
  [1250, 4], // كرواسون
  [900, 3], // كوكيز
  [2400, 3], // كيكة
  [2650, 2], // ساندويتش
  [1750, 2], // مافن
]

const FEMALE = 'نورة سارة ريم هند لمى رهف جود دانة شهد أمل منى هيفاء غادة رزان لينا ديما مها أروى بشرى عبير وعد رغد جواهر نوف أسماء مريم فاطمة خلود تهاني سمر ليان جنى يارا حلا بيان شوق'.split(' ')
const MALE = 'عبدالله محمد أحمد فهد خالد سعود تركي فيصل ماجد سلطان بندر نايف عبدالرحمن عمر يوسف إبراهيم حسن علي أنس زياد رائد هشام وليد مازن باسل عادل طلال معاذ ريان سامي حاتم مشاري نواف عبدالعزيز صالح ياسر'.split(' ')
const FAMILY =
  'الغامدي الزهراني الحربي القرشي باعشن العمودي باخشب الشهري القحطاني العتيبي المالكي الجهني السلمي اللحياني الثقفي باجنيد بافقيه الصبحي المطيري الدوسري الأنصاري فلمبان كعكي قاضي الشريف العطاس باناجه الحارثي البركاتي المولد السقاف بخاري تركستاني هوساوي الفيفي عسيري الشمراني البيشي المحمادي الردادي'.split(
    ' ',
  )

const GIFT_MESSAGES = [
  'كل عام وأنتِ بخير، قهوتك علي هالمرة ☕',
  'مبروك التخرج! فخورين فيك 🎓',
  'شكراً على كل شيء يا أستاذة 🌷',
  'عيد ميلاد سعيد، تستاهل أحلى كوب',
  'بالتوفيق في وظيفتك الجديدة 💼',
  'هدية بسيطة لأحلى صديقة',
  'ألف مبروك المولود الجديد 👶',
  'شكراً لفريقك على جهودهم هذا الشهر',
  'لأنك تحب القهوة أكثر مني 😄',
  'يومك سعيد يا أمي ❤️',
]

// ------------------------------------------------------------------ campaigns (dates adapt to "today")
function nearestWeekdayAgo(target, around) {
  for (let delta = 0; delta < 7; delta++) {
    if (weekday(around + delta) === target) return around + delta
    if (around - delta > 2 && weekday(around - delta) === target) return around - delta
  }
  return around
}
const DOUBLE_POINTS_DAY = nearestWeekdayAgo(3, 24) // a Wednesday ~3.5 weeks ago; Thu + Fri are double points
const nationalDay = (() => {
  const riyadhNow = new Date(NOW + RIYADH)
  let year = riyadhNow.getUTCFullYear()
  let ago = Math.round((TODAY - (Date.UTC(year, 8, 23) - RIYADH)) / DAY)
  if (ago < 0) {
    year -= 1
    ago = Math.round((TODAY - (Date.UTC(year, 8, 23) - RIYADH)) / DAY)
  }
  return ago >= 3 && ago <= 58 && Math.abs(ago - DOUBLE_POINTS_DAY) > 3 ? { ago, nth: year - 1930 } : null
})()

const CAMPAIGNS = [
  {
    ago: 58,
    minute: 7 * 60 + 5,
    program: 'points',
    audience: 'consented',
    by: 'manager',
    title: 'عرض المعلمين والمعلمات 📚',
    body: 'مع بداية العام الدراسي: قهوة + كرواسون بـ 19 ريال للمعلمين والمعلمات طوال الأسبوع. أظهر بطاقتك عند الكاشير ☕',
  },
  {
    ago: 45,
    minute: 9 * 60 + 30,
    program: 'points',
    audience: 'all',
    by: 'owner',
    title: 'افتتحنا فرع أبحر الشمالية 🎉',
    body: 'فرعنا الثالث في أبحر الشمالية مفتوح الآن على الكورنيش. أول زيارة لك هناك = 50 نقطة هدية تُضاف تلقائياً لبطاقتك.',
  },
  {
    ago: 38,
    minute: 16 * 60 + 10,
    program: 'stamps',
    audience: 'consented',
    by: 'manager',
    title: 'محصول جديد: إثيوبيا يرغاتشيفي',
    body: 'وصل محصول يرغاتشيفي الجديد بنكهات الياسمين والليمون. جرّبه اليوم V60 أو تقطير بارد، وختمك علينا كالعادة.',
  },
  ...(nationalDay
    ? [
        {
          ago: nationalDay.ago + 1,
          minute: 18 * 60,
          program: 'points',
          audience: 'consented',
          by: 'owner',
          title: `اليوم الوطني ${nationalDay.nth} 💚`,
          body: `كل عام والوطن بخير! بمناسبة اليوم الوطني ${nationalDay.nth}: لاتيه سعودي بسعر خاص ونقاط مضاعفة طوال يوم الوطن في جميع فروعنا.`,
        },
      ]
    : []),
  {
    ago: DOUBLE_POINTS_DAY,
    minute: 17 * 60 + 45,
    program: 'points',
    audience: 'consented',
    by: 'manager',
    title: 'نقاط مضاعفة نهاية الأسبوع ⚡',
    body: 'الخميس والجمعة فقط: كل ريال = نقطتين في جميع فروع بُنّ الحجاز. تُضاف النقاط الإضافية تلقائياً مع كل فاتورة.',
  },
  {
    ago: 17,
    minute: 11 * 60 + 20,
    program: 'stamps',
    audience: 'all',
    by: 'manager',
    title: 'كوبك المجاني قريب ☕',
    body: 'باقي لك أختام قليلة على الكوب المجاني. زرنا هذا الأسبوع وأكمل بطاقتك في أي فرع.',
  },
  {
    ago: 10,
    minute: 15 * 60 + 40,
    program: 'points',
    audience: 'consented',
    by: 'owner',
    title: 'حلويات الخريف وصلت 🍂',
    body: 'كيكة اليقطين وتشيز كيك اللوتس متوفرة الآن بكميات محدودة. استبدل 260 نقطة بقطعة مجاناً.',
  },
  {
    ago: 3,
    minute: 6 * 60 + 15,
    program: 'points',
    audience: 'consented',
    by: 'manager',
    title: 'صباحك أحلى مع بُنّ الحجاز ☀️',
    body: 'من 6:30 إلى 9:30 صباحاً هذا الأسبوع: أي مشروب حار + 20 نقطة إضافية تُضاف لبطاقتك تلقائياً.',
  },
]
for (const c of CAMPAIGNS) {
  if (c.title.length > 40 || c.body.length > 200) throw new Error(`campaign copy too long: ${c.title}`)
}

// ------------------------------------------------------------------ programmes
const LOCATIONS = BRANCHES.map(({ name, latitude, longitude }) => ({ name, latitude, longitude }))
const PROGRAMS = {
  summer: {
    id: uuid(),
    name: 'بطاقة الصيف المثلّجة',
    type: 'stamps',
    status: 'archived',
    selfEnroll: false,
    createdAgo: 151,
    config: { stampsPerVisit: 1, stampsRequired: 6, minPurchaseMinor: 1800 },
    design: {
      layout: 'strip',
      background: '#0f6f74',
      foreground: '#ffffff',
      label: '#bfe6e8',
      stampColor: '#ffffff',
      stampShape: 'star',
      barcode: 'qr',
      front: ['member', 'remaining'],
      back: ['code', 'reward', 'terms', 'link'],
      rewardText: '6 مشروبات مثلّجة = السابع مجاناً 🧊',
      notes: [{ label: 'مدة العرض', value: 'عرض موسمي لصيف هذا العام. الأختام المتبقية تُستبدل حتى نهاية العام في جميع الفروع.' }],
      locations: LOCATIONS.slice(0, 2),
      nearby: false,
    },
  },
  stamps: {
    id: uuid(),
    name: 'بطاقة القهوة',
    type: 'stamps',
    status: 'active',
    selfEnroll: true,
    createdAgo: 150,
    config: { stampsPerVisit: 1, stampsRequired: 8, minPurchaseMinor: 1500 },
    design: {
      layout: 'strip',
      background: '#fbf4ea',
      foreground: '#3b2418',
      label: '#8a6a52',
      stampColor: '#6b3f27',
      stampShape: 'custom',
      barcode: 'qr',
      front: ['member', 'remaining'],
      back: ['code', 'reward', 'terms', 'link'],
      rewardText: 'اجمع 8 أختام والكوب التاسع علينا ☕',
      notes: [
        { label: 'الشروط', value: 'ختم واحد لكل زيارة بقيمة 15 ريال أو أكثر. الكوب المجاني لأي مشروب حجم وسط.' },
        { label: 'ساعات العمل', value: 'يومياً من 6:30 صباحاً حتى 1:00 بعد منتصف الليل · الجمعة من 1:00 ظهراً' },
      ],
      locations: LOCATIONS,
      nearby: false,
    },
  },
  points: {
    id: uuid(),
    name: 'نقاط بُنّ الحجاز',
    type: 'points',
    status: 'active',
    selfEnroll: true,
    createdAgo: 150,
    config: { pointsPerUnit: 1, unitMinor: 100, minPurchaseMinor: 0, maxPointsPerTxn: 500 },
    design: {
      layout: 'classic',
      background: '#2b1a12',
      foreground: '#f5e6c4',
      label: '#c9a85c',
      stampColor: '#c9a85c',
      stampShape: 'circle',
      barcode: 'qr',
      front: ['member', 'lifetime'],
      back: ['code', 'reward', 'terms', 'link'],
      rewardText: 'كل ريال = نقطة · استبدل 120 نقطة بقهوة اليوم مجاناً',
      notes: [
        { label: 'المكافآت', value: REWARDS.map((r) => `${r.name} ${r.cost}`).join(' · ') + ' نقطة' },
        { label: 'المستويات', value: 'برونزي: حتى 999 نقطة مكتسبة · فضي: من 1,000 نقطة (ترقية الحجم مجاناً) · ذهبي: من 3,000 نقطة (مشروب مجاني كل شهر)' },
        { label: 'ساعات العمل', value: 'يومياً من 6:30 صباحاً حتى 1:00 بعد منتصف الليل · الجمعة من 1:00 ظهراً' },
        { label: 'تواصل معنا', value: 'واتساب: 0500000900' },
      ],
      locations: LOCATIONS,
      nearby: true,
      nearbyText: 'قريب من بُنّ الحجاز؟ قهوتك المفضلة بانتظارك ☕',
    },
  },
}
for (const p of Object.values(PROGRAMS)) {
  const checked = validateProgramConfig(p.type, p.config)
  if (!checked.ok) throw new Error(`invalid config for ${p.name}: ${checked.error}`)
  p.config = checked.config
  p.design = normalizeDesign(p.design)
}
const SUMMER_FROM = 140
const SUMMER_TO = 62

// ------------------------------------------------------------------ members
const DEMO_CUSTOMER = {
  id: '5a7a0000-0000-4000-8000-000000000100',
  phone: '+966500000100',
  name: 'سارة الشهري',
  email: `customer@${DEMO_DOMAIN}`,
  pointsToken: 'demo-customer-points-card-bunn-alhijaz',
  stampsToken: 'demo-customer-stamps-card-bunn-alhijaz',
  summerToken: 'demo-customer-summer-card-bunn-alhijaz',
}
const MEMBER_COUNT = 360

function sampleMinute(daysAgo) {
  const fri = weekday(daysAgo) === 5
  const slot = weighted(
    fri
      ? [
          ['afternoon', 45],
          ['evening', 55],
        ]
      : [
          ['morning', 36],
          ['afternoon', 20],
          ['evening', 44],
        ],
  )
  if (slot === 'morning') return between(6 * 60 + 30, 11 * 60)
  if (slot === 'afternoon') return between(fri ? 13 * 60 + 10 : 13 * 60, 17 * 60 + 30)
  return between(18 * 60, 24 * 60 + 40)
}

function samplePurchase() {
  const items = weighted([
    [1, 38],
    [2, 36],
    [3, 16],
    [4, 7],
    [between(5, 9), 3],
  ])
  let total = 0
  for (let i = 0; i < items; i++) total += weighted(MENU.map(([price, w]) => [price, w]))
  return total
}

const usedNames = new Set([DEMO_CUSTOMER.name, ...STAFF.map((s) => s.name)])
function personName() {
  for (let i = 0; i < 20; i++) {
    const n = `${pick(chance(0.52) ? MALE : FEMALE)} ${pick(FAMILY)}`
    if (!usedNames.has(n)) {
      usedNames.add(n)
      return n
    }
  }
  return `${pick(MALE)} ${pick(FAMILY)}`
}

function preferredBranch(joinAgo) {
  const open = BRANCHES.filter((b) => b.opensAgo >= joinAgo)
  // Members who joined after Obhur opened lean towards it (that is where they signed up).
  return weighted(open.map((b) => [b.key, b.key === 'obh' ? 0.45 : b.weight]))
}

const members = []
for (let i = 0; i < MEMBER_COUNT; i++) {
  const demo = i === 0
  const segment = demo
    ? 'loyal'
    : weighted([
        ['loyal', 12],
        ['regular', 28],
        ['occasional', 38],
        ['rare', 22],
      ])
  // Launch burst, then steady sign-ups; Obhur's opening brings a wave.
  const joinAgo = demo
    ? 140
    : weighted([
        [between(LAUNCH - 14, LAUNCH), 22],
        [between(46, LAUNCH - 15), 43],
        [between(38, 45), 9],
        [between(0, 37), 26],
      ])
  const rate = { loyal: 3 + rand() * 2, regular: 1.1 + rand() * 1.1, occasional: 0.3 + rand() * 0.5, rare: 0 }[segment]
  const churnAgo = segment === 'rare' || demo ? -1 : chance(segment === 'loyal' ? 0.05 : 0.17) ? between(0, Math.max(0, joinAgo - 7)) : -1
  const named = demo || chance(0.97)
  let joinAgoFixed = joinAgo
  const joinMinute = demo ? 8 * 60 + 12 : sampleMinute(joinAgo)
  // Someone "joining today" at a time still ahead of us joined yesterday instead.
  if (at(joinAgoFixed, joinMinute).getTime() > LATEST - 10 * MIN) joinAgoFixed += 1
  members.push({
    i,
    id: demo ? DEMO_CUSTOMER.id : uuid(),
    phone: demo ? DEMO_CUSTOMER.phone : `+96650000${String(1000 + i * 7).padStart(4, '0')}`,
    name: demo ? DEMO_CUSTOMER.name : named ? personName() : null,
    email: demo ? DEMO_CUSTOMER.email : null,
    locale: demo || chance(0.95) ? 'ar' : 'en',
    consent: demo || chance(0.7),
    verified: demo || chance(0.88),
    segment,
    rate,
    joinAgo: joinAgoFixed,
    joinMinute,
    churnAgo,
    branch: demo ? 'rwd' : preferredBranch(joinAgo),
    wantsStamps: demo || chance(0.6),
    wantsSummer: demo || chance(0.5),
  })
}

// ------------------------------------------------------------------ visits
const campaignByTitle = (prefix) => CAMPAIGNS.find((c) => c.title.startsWith(prefix))
function dayFactor(ago) {
  let f = { 4: 1.25, 5: 1.2, 6: 1.05 }[weekday(ago)] ?? 1
  if (ago === DOUBLE_POINTS_DAY - 1 || ago === DOUBLE_POINTS_DAY - 2) f *= 1.6
  if (nationalDay && ago === nationalDay.ago) f *= 1.45
  if (ago <= 16 && ago >= 12) f *= 1.15 // "your free cup is close"
  if (ago <= 2) f *= 1.15 // morning bonus week
  return f
}

const visits = []
for (const m of members) {
  const days = []
  if (m.segment === 'rare') {
    days.push(m.joinAgo)
    const extra = between(0, 2)
    for (let k = 0; k < extra; k++) days.push(between(Math.max(0, m.joinAgo - 40), m.joinAgo))
  } else {
    days.push(m.joinAgo)
    for (let d = m.joinAgo - 1; d >= 0; d--) {
      if (m.churnAgo >= 0 && d < m.churnAgo) break
      if (chance((m.rate / 7) * dayFactor(d))) days.push(d)
    }
  }
  const seen = new Set()
  for (const d of days) {
    if (seen.has(d)) continue
    seen.add(d)
    const minute = d === m.joinAgo ? m.joinMinute : sampleMinute(d)
    const ts = at(d, minute).getTime()
    if (ts > LATEST) continue
    const open = BRANCHES.filter((b) => b.opensAgo >= d)
    let branch = branchByKey[m.branch]
    if (branch.opensAgo < d || chance(0.22)) branch = branchByKey[weighted(open.map((b) => [b.key, b.weight]))]
    if (branch.opensAgo < d) branch = open[0]
    visits.push({ m, ago: d, minute, ts, branch, purchase: samplePurchase(), first: d === m.joinAgo })
  }
}
visits.sort((a, b) => a.ts - b.ts)

// ------------------------------------------------------------------ simulate the ledger
const staffByKey = Object.fromEntries(STAFF.map((s) => [s.key, { ...s, id: uuid() }]))
const accounts = new Map() // `${programKey}:${memberId}` → account
const entries = []
let seq = 0

function account(programKey, m, createdTs) {
  const k = `${programKey}:${m.id}`
  let a = accounts.get(k)
  if (!a) {
    const demo = m.id === DEMO_CUSTOMER.id
    a = {
      id: uuid(),
      programKey,
      program: PROGRAMS[programKey],
      member: m,
      balance: 0,
      lifetime: 0,
      createdTs,
      updatedTs: createdTs,
      code: demo ? { points: 'BH0100PTS1', stamps: 'BH0100STM1', summer: 'BH0100SUM1' }[programKey] : crock(10),
      passToken: demo ? { points: DEMO_CUSTOMER.pointsToken, stamps: DEMO_CUSTOMER.stampsToken, summer: DEMO_CUSTOMER.summerToken }[programKey] : hex(64),
      appleAuth: hex(32),
    }
    accounts.set(k, a)
  }
  return a
}

function post(a, { kind, amount, ts, source = 'pos', ref = null, note = null, purchase = null, actor = null, reverses = null }) {
  const balanceAfter = a.balance + amount
  if (balanceAfter < 0) throw new Error('negative balance in seed')
  a.balance = balanceAfter
  if (kind === 'earn') a.lifetime += amount
  if (kind === 'void' && reverses?.kind === 'earn') a.lifetime += amount
  a.updatedTs = Math.max(a.updatedTs, ts)
  seq += 1
  const key = `seed-le-${String(seq).padStart(6, '0')}`
  const e = {
    id: uuid(),
    account: a,
    kind,
    amount,
    balanceAfter,
    source,
    ref,
    note,
    purchase,
    actor,
    key,
    hash: sha256(key),
    reverses: reverses?.id ?? null,
    ts,
  }
  entries.push(e)
  return e
}

function cashierFor(branch, ts) {
  const r = rand()
  if (r < 0.08) return staffByKey.manager
  if (r < 0.11) return staffByKey.owner
  const own = staffByKey[branch.key]
  // Obhur's cashier joined two days before it opened; before that nobody works there.
  return ts >= at(own.joinedAgo, 0).getTime() ? own : staffByKey.manager
}

const campaignTs = (c) => at(c.ago, c.minute).getTime()
const obhurOpening = campaignByTitle('افتتحنا فرع أبحر')
const fallTreats = campaignByTitle('حلويات الخريف')
const morningBonus = campaignByTitle('صباحك أحلى')
const doublePoints = campaignByTitle('نقاط مضاعفة')
const obhurGifted = new Set()
let obhurGifts = 0
const VOID_REASONS = ['فاتورة مكررة — تم الإلغاء', 'إلغاء الطلب بطلب العميل', 'أُدخلت على العضو الخطأ']
const ADJUST_REASONS = ['تعويض عن تأخير الطلب', 'تعويض عن خطأ في الطلب', 'نقاط عيد ميلاد 🎂', 'مشاركة في استبيان رضا العملاء', 'هدية تقدير لعميل دائم']

// The sample customer opened her stamp card a few visits in, so her card shows 6 of 8 today.
const isDemo = (m) => m.id === DEMO_CUSTOMER.id
const demoQualifying = visits.filter((v) => isDemo(v.m) && v.purchase >= PROGRAMS.stamps.config.minPurchaseMinor).length
let demoStampSkips = (((demoQualifying - 6) % 8) + 8) % 8

for (const v of visits) {
  const { m, branch, ts, purchase } = v
  const invoice = `${branch.code}-${branch.invoice++}`
  const cashier = cashierFor(branch, ts)
  const source = chance(0.82) ? 'pos' : 'console'
  const pts = account('points', m, v.first ? ts - 2 * MIN : ts)
  const earned = computeEarn('points', PROGRAMS.points.config, purchase)
  const t = ts
  const earnEntry = post(pts, { kind: 'earn', amount: earned, ts: t, source, ref: invoice, note: branch.name, purchase, actor: cashier.id })

  // Campaign results: bonus points posted by the campaign itself.
  if (doublePoints && m.consent && (v.ago === doublePoints.ago - 1 || v.ago === doublePoints.ago - 2) && ts > campaignTs(doublePoints)) {
    post(pts, { kind: 'earn', amount: earned, ts: t + 20_000, source: 'campaign', ref: invoice, note: 'حملة: نقاط مضاعفة نهاية الأسبوع' })
  }
  if (nationalDay && m.consent && v.ago === nationalDay.ago) {
    post(pts, { kind: 'earn', amount: earned, ts: t + 20_000, source: 'campaign', ref: invoice, note: `حملة: اليوم الوطني ${nationalDay.nth}` })
  }
  if (obhurOpening && branch.key === 'obh' && !obhurGifted.has(m.id) && obhurGifts < 100 && ts > campaignTs(obhurOpening) && v.ago >= obhurOpening.ago - 10) {
    obhurGifted.add(m.id)
    obhurGifts += 1
    post(pts, { kind: 'earn', amount: 50, ts: t + 25_000, source: 'campaign', note: 'هدية افتتاح فرع أبحر الشمالية' })
  }
  if (morningBonus && m.consent && ts > campaignTs(morningBonus) && v.minute >= 6 * 60 + 30 && v.minute <= 9 * 60 + 30) {
    post(pts, { kind: 'earn', amount: 20, ts: t + 25_000, source: 'campaign', ref: invoice, note: 'حملة: صباحك أحلى (+20 نقطة)' })
  }

  // Stamp card (active since launch).
  if (m.wantsStamps && purchase >= PROGRAMS.stamps.config.minPurchaseMinor && !(isDemo(m) && demoStampSkips-- > 0)) {
    const st = account('stamps', m, ts - MIN)
    if (st.balance >= 8 && (chance(0.85) || isDemo(m))) {
      post(st, { kind: 'redeem', amount: -8, ts: t + 10_000, source, ref: invoice, note: 'مكافأة: الكوب التاسع مجاناً', actor: cashier.id })
    }
    post(st, { kind: 'earn', amount: 1, ts: t + 15_000, source, ref: invoice, note: branch.name, purchase, actor: cashier.id })
  }

  // Seasonal summer card.
  if (m.wantsSummer && v.ago <= SUMMER_FROM && v.ago >= SUMMER_TO && purchase >= PROGRAMS.summer.config.minPurchaseMinor && chance(0.65)) {
    const su = account('summer', m, ts - MIN)
    if (su.balance >= 6 && chance(0.85)) {
      post(su, { kind: 'redeem', amount: -6, ts: t + 12_000, source, ref: invoice, note: 'مكافأة: مشروب مثلّج مجاني', actor: cashier.id })
    }
    post(su, { kind: 'earn', amount: 1, ts: t + 18_000, source, ref: invoice, note: branch.name, purchase, actor: cashier.id })
  }

  // Points rewards.
  if (pts.balance >= REWARDS[0].cost && chance(m.segment === 'loyal' ? 0.2 : 0.15)) {
    const fall = fallTreats && ts > campaignTs(fallTreats)
    const affordable = REWARDS.filter((r) => r.cost <= pts.balance)
    const reward = weighted(affordable.map((r) => [r, r.cost === 260 && fall ? r.w * 4 : r.w]))
    post(pts, { kind: 'redeem', amount: -reward.cost, ts: t + 40_000, source, ref: invoice, note: `مكافأة: ${reward.name}`, actor: cashier.id })
  }

  // Mistakes happen: a manager voids the duplicate a few minutes later (never below zero).
  if (chance(0.0035) && pts.balance >= earned) {
    post(pts, { kind: 'void', amount: -earned, ts: t + between(2, 9) * MIN, source: 'console', note: pick(VOID_REASONS), actor: staffByKey.manager.id, reverses: earnEntry })
  }
  // Goodwill corrections (posted after any void, so balances stay in time order).
  if (chance(0.004)) {
    post(pts, { kind: 'adjust', amount: between(3, 12) * 5, ts: t + between(10, 30) * MIN, source: 'console', note: pick(ADJUST_REASONS), actor: staffByKey.manager.id })
  } else if (chance(0.0012) && pts.balance >= 40) {
    post(pts, { kind: 'adjust', amount: -between(2, 8) * 5, ts: t + between(10, 30) * MIN, source: 'console', note: 'تصحيح نقاط أُضيفت بالخطأ', actor: staffByKey.manager.id })
  }
}

// ------------------------------------------------------------------ gift cards
const giftCards = []
const giftEntries = []
let giftSeq = 0
function giftEntry(card, { kind, amount, ts, ref = null, note = null, actor = null }) {
  card.balance += amount
  if (card.balance < 0) throw new Error('negative gift balance in seed')
  card.updatedTs = Math.max(card.updatedTs, ts)
  giftSeq += 1
  const key = `seed-gc-${String(giftSeq).padStart(5, '0')}`
  giftEntries.push({ id: uuid(), card, kind, amount, balanceAfter: card.balance, ref, note, actor, key, hash: sha256(key), ts })
}
const GIFT_AMOUNTS = [
  [5000, 3],
  [10000, 5],
  [15000, 2],
  [20000, 3],
  [30000, 1.5],
  [50000, 0.8],
]
for (let i = 0; i < 30; i++) {
  const demo = i === 0
  const fate = demo
    ? 'partial'
    : i === 1
      ? 'frozen'
      : i === 2
        ? 'voided'
        : i === 3
          ? 'expired'
          : weighted([
              ['untouched', 45],
              ['partial', 35],
              ['spent', 15],
            ])
  // The expired card was sold with a one-month validity seven weeks ago.
  const ago = demo ? 26 : fate === 'expired' ? 49 : between(0, 58)
  const createdTs = Math.min(at(ago, sampleMinute(ago)).getTime(), LATEST - 30 * MIN)
  const amount = demo ? 20000 : weighted(GIFT_AMOUNTS)
  const issuedBy = pick([staffByKey.rwd, staffByKey.sht, staffByKey.manager, ...(ago < 44 ? [staffByKey.obh] : [])])
  const code = crock(16)
  const card = {
    id: uuid(),
    code,
    token: demo ? 'demo-gift-card-bunn-alhijaz-0001' : token(32),
    initial: amount,
    balance: 0,
    status: fate === 'frozen' ? 'frozen' : fate === 'voided' ? 'voided' : 'active',
    expiresAt: new Date(createdTs + (fate === 'expired' ? 30 : 365) * DAY),
    recipientName: demo ? DEMO_CUSTOMER.name : personName(),
    recipientPhone: demo ? DEMO_CUSTOMER.phone : chance(0.8) ? `+96650000${String(5000 + i * 13).padStart(4, '0')}` : null,
    senderName: demo ? 'نوف الشهري' : chance(0.85) ? personName() : null,
    message: demo ? 'كل عام وأنتِ بخير يا أحلى أخت، قهوتك علي ☕' : chance(0.8) ? pick(GIFT_MESSAGES) : null,
    createdBy: issuedBy.id,
    createdTs,
    updatedTs: createdTs,
  }
  giftEntry(card, { kind: 'issue', amount, ts: createdTs, actor: issuedBy.id })
  let t = createdTs
  /* One redemption a few days after the previous one; false when that would be in the future. */
  const spend = (minor, maxDays = 9) => {
    const next = t + between(1, maxDays) * DAY + between(0, 600) * MIN
    if (next > LATEST - 5 * MIN) return false
    t = next
    const branch = pick(BRANCHES.filter((b) => at(b.opensAgo, 0).getTime() <= t))
    const cashier = t >= at(staffByKey[branch.key].joinedAgo, 0).getTime() ? staffByKey[branch.key] : staffByKey.manager
    giftEntry(card, { kind: 'redeem', amount: -minor, ts: t, ref: `${branch.code}-${between(10000, 49999)}`, note: branch.name, actor: cashier.id })
    return true
  }
  if (demo) spend(4650)
  else if (fate === 'expired') spend(Math.min(card.balance - 1000, between(18, 40) * 100), 6)
  else if (fate === 'partial' || fate === 'frozen') {
    const n = between(1, 3)
    for (let k = 0; k < n && card.balance > 2000; k++) if (!spend(Math.min(card.balance - 500, between(14, 70) * 100 + pick([0, 0, 50])))) break
  } else if (fate === 'spent') {
    while (card.balance > 0) if (!spend(card.balance <= 6000 ? card.balance : between(25, 60) * 100, 6)) break
  }
  if (fate === 'voided') {
    t = Math.max(t + 1, Math.min(t + between(1, 3) * DAY, LATEST - 5 * MIN))
    giftEntry(card, { kind: 'void', amount: -card.balance, ts: t, note: 'أُلغيت بطلب المشتري واسترد المبلغ من نقطة البيع', actor: staffByKey.manager.id })
  }
  giftCards.push(card)
}

// ------------------------------------------------------------------ write everything
const db = await openDb(DATABASE_URL)
await migrate(db)

async function insert(tx, table, columns, rows) {
  const per = Math.max(1, Math.floor(30000 / columns.length))
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per)
    const params = []
    const values = chunk.map((row) => `(${row.map((v) => (params.push(v), `$${params.length}`)).join(',')})`)
    await tx.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values.join(',')}`, params)
  }
}

const iso = (ms) => new Date(ms).toISOString()
const tenantId = uuid()
const passwordHash = await hashPassword(PASSWORD)
const logo = readFileSync(join(HERE, 'assets', 'logo.png'))
const bean = readFileSync(join(HERE, 'assets', 'stamp-bean.png'))

await db.tx(async (tx) => {
  // Empty every app table (not the migration log). TRUNCATE skips the row-level append-only triggers.
  const { rows: tables } = await tx.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY tablename",
  )
  await tx.query(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`)

  await insert(
    tx,
    'tenants',
    ['id', 'name', 'slug', 'created_at', 'logo', 'logo_version', 'billing_phone'],
    [[tenantId, TENANT_NAME, SLUG, iso(at(152, 9 * 60).getTime()), logo, Math.floor(NOW / 1000) - 86400 * 140, '+966500000900']],
  )
  await insert(
    tx,
    'users',
    ['id', 'email', 'password_hash', 'name', 'locale', 'created_at', 'email_verified_at'],
    STAFF.map((s) => {
      const u = staffByKey[s.key]
      const ts = iso(at(s.joinedAgo, 10 * 60).getTime())
      return [u.id, s.email, passwordHash, s.name, 'ar', ts, ts]
    }),
  )
  await insert(
    tx,
    'memberships',
    ['tenant_id', 'user_id', 'role', 'created_at'],
    STAFF.map((s) => [tenantId, staffByKey[s.key].id, s.role, iso(at(s.joinedAgo, 10 * 60).getTime())]),
  )
  await insert(
    tx,
    'programs',
    ['id', 'tenant_id', 'name', 'type', 'status', 'config', 'design', 'self_enroll', 'created_at', 'updated_at'],
    Object.values(PROGRAMS).map((p) => [
      p.id,
      tenantId,
      p.name,
      p.type,
      p.status,
      JSON.stringify(p.config),
      JSON.stringify(p.design),
      p.selfEnroll,
      iso(at(p.createdAgo, 11 * 60).getTime()),
      iso(p.status === 'archived' ? at(SUMMER_TO - 2, 12 * 60).getTime() : at(20, 12 * 60).getTime()),
    ]),
  )
  await insert(tx, 'program_stamps', ['program_id', 'tenant_id', 'png', 'updated_at'], [[PROGRAMS.stamps.id, tenantId, bean, iso(at(120, 13 * 60).getTime())]])

  await insert(
    tx,
    'members',
    ['id', 'tenant_id', 'phone', 'name', 'email', 'locale', 'marketing_consent', 'consent_at', 'created_at', 'verified'],
    members.map((m) => {
      const ts = iso(at(m.joinAgo, m.joinMinute).getTime() - 3 * MIN)
      return [m.id, tenantId, m.phone, m.name, m.email, m.locale, m.consent, m.consent ? ts : null, ts, m.verified]
    }),
  )
  await insert(
    tx,
    'accounts',
    ['id', 'tenant_id', 'program_id', 'member_id', 'balance', 'lifetime_earned', 'created_at', 'updated_at', 'code', 'pass_token', 'apple_auth'],
    [...accounts.values()].map((a) => [
      a.id,
      tenantId,
      a.program.id,
      a.member.id,
      a.balance,
      a.lifetime,
      iso(a.createdTs),
      iso(a.updatedTs),
      a.code,
      a.passToken,
      a.appleAuth,
    ]),
  )
  entries.sort((a, b) => a.ts - b.ts)
  await insert(
    tx,
    'ledger_entries',
    [
      'id',
      'tenant_id',
      'account_id',
      'kind',
      'amount',
      'balance_after',
      'source',
      'ref',
      'note',
      'purchase_minor',
      'actor_user_id',
      'idempotency_key',
      'request_hash',
      'reverses_entry_id',
      'created_at',
    ],
    entries.map((e) => [
      e.id,
      tenantId,
      e.account.id,
      e.kind,
      e.amount,
      e.balanceAfter,
      e.source,
      e.ref,
      e.note,
      e.purchase,
      e.actor,
      e.key,
      e.hash,
      e.reverses,
      iso(e.ts),
    ]),
  )

  // Campaigns: the audience is whoever held the card (and consented, when asked) at send time.
  const campaignRows = []
  const recipientRows = []
  CAMPAIGNS.forEach((c, n) => {
    const id = uuid()
    const ts = campaignTs(c)
    const program = PROGRAMS[c.program]
    const audience = [...accounts.values()].filter((a) => a.program === program && a.createdTs <= ts && (c.audience === 'all' || a.member.consent))
    const key = `seed-campaign-${n + 1}`
    campaignRows.push([
      id,
      tenantId,
      program.id,
      c.title,
      c.body,
      c.audience,
      audience.length,
      'sent',
      staffByKey[c.by].id,
      key,
      sha256(key),
      iso(ts),
      iso(ts + 2 * MIN),
    ])
    for (const a of audience) recipientRows.push([id, tenantId, a.id])
  })
  await insert(
    tx,
    'campaigns',
    ['id', 'tenant_id', 'program_id', 'title', 'body', 'audience', 'recipients', 'status', 'created_by', 'idempotency_key', 'request_hash', 'created_at', 'sent_at'],
    campaignRows,
  )
  await insert(tx, 'campaign_recipients', ['campaign_id', 'tenant_id', 'account_id'], recipientRows)

  await insert(
    tx,
    'gift_cards',
    [
      'id',
      'tenant_id',
      'code_hash',
      'code_last4',
      'code_sealed',
      'public_token',
      'initial_minor',
      'balance_minor',
      'status',
      'expires_at',
      'recipient_name',
      'recipient_phone',
      'sender_name',
      'message',
      'created_by',
      'created_at',
      'updated_at',
    ],
    giftCards.map((g) => [
      g.id,
      tenantId,
      sha256(g.code),
      g.code.slice(-4),
      seal(g.code, SECRET_KEY),
      g.token,
      g.initial,
      g.balance,
      g.status,
      iso(g.expiresAt),
      g.recipientName,
      g.recipientPhone,
      g.senderName,
      g.message,
      g.createdBy,
      iso(g.createdTs),
      iso(g.updatedTs),
    ]),
  )
  giftEntries.sort((a, b) => a.ts - b.ts)
  await insert(
    tx,
    'gift_card_entries',
    ['id', 'tenant_id', 'gift_card_id', 'kind', 'amount_minor', 'balance_after', 'ref', 'note', 'actor_user_id', 'idempotency_key', 'request_hash', 'created_at'],
    giftEntries.map((e) => [e.id, tenantId, e.card.id, e.kind, e.amount, e.balanceAfter, e.ref, e.note, e.actor, e.key, e.hash, iso(e.ts)]),
  )

  // An active yearly subscription, paid 75 days ago (no payment provider is called in the demo).
  const paidTs = at(75, 10 * 60 + 40).getTime()
  const expires = paidTs + 365 * DAY
  const checkoutId = uuid()
  await insert(
    tx,
    'subscription_checkouts',
    ['id', 'tenant_id', 'request_key', 'cycle', 'amount', 'invoice_id', 'status', 'payment_id', 'created_at', 'paid_at'],
    [[checkoutId, tenantId, 'seed-checkout-0001', 'yearly', 69000, `demo-invoice-${hex(8)}`, 'paid', `demo-payment-${hex(8)}`, iso(paidTs - 4 * MIN), iso(paidTs)]],
  )
  await insert(
    tx,
    'subscriptions',
    ['tenant_id', 'cycle', 'expires_at', 'updated_at', 'status', 'auto_renew'],
    [[tenantId, 'yearly', iso(expires), iso(paidTs), 'active', true]],
  )
  await insert(
    tx,
    'subscription_events',
    ['tenant_id', 'kind', 'ref', 'data', 'email_status', 'created_at'],
    [[tenantId, 'activated', checkoutId, JSON.stringify({ cycle: 'yearly', amountMinor: 69000, expiresAt: iso(expires) }), 'skipped', iso(paidTs)]],
  )

  await insert(
    tx,
    'audit_log',
    ['tenant_id', 'actor_user_id', 'action', 'target', 'data', 'created_at'],
    [
      [tenantId, staffByKey.owner.id, 'tenant.created', null, '{}', iso(at(152, 9 * 60).getTime())],
      ...STAFF.filter((s) => s.role !== 'owner').map((s) => [
        tenantId,
        staffByKey.owner.id,
        'staff.added',
        staffByKey[s.key].id,
        JSON.stringify({ role: s.role }),
        iso(at(s.joinedAgo, 10 * 60).getTime()),
      ]),
      ...campaignRows.map((c) => [tenantId, c[8], 'campaign.sent', c[0], JSON.stringify({ programId: c[2], audience: c[5], recipients: c[6] }), c[11]]),
    ],
  )
})

const drift = await reconcile(db, { tenantId })
if (drift.length) throw new Error(`ledger drift after seeding: ${JSON.stringify(drift.slice(0, 3))}`)

const { rows: stats } = await db.query(
  `SELECT (SELECT count(*) FROM members) AS members, (SELECT count(*) FROM accounts) AS accounts,
          (SELECT count(*) FROM ledger_entries) AS entries,
          (SELECT count(*) FROM ledger_entries WHERE created_at > now() - interval '60 days') AS entries_60d,
          (SELECT count(*) FROM ledger_entries WHERE created_at > now() - interval '1 day') AS entries_24h,
          (SELECT count(*) FROM campaigns) AS campaigns, (SELECT count(*) FROM gift_cards) AS gift_cards`,
)
const demoAccounts = [...accounts.values()].filter((a) => a.member.id === DEMO_CUSTOMER.id)
console.log(
  `[demo-seed] ${TENANT_NAME}: ${JSON.stringify(stats[0])}; demo customer ${demoAccounts.map((a) => `${a.programKey}=${a.balance}/${a.lifetime}`).join(' ')}`,
)
await db.close()
