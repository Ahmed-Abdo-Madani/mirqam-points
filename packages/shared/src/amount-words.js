/* Amount in words for Saudi riyals (تفقيط), Arabic and English. Pure and integer-only.
   Input: a whole number of halalas (integer minor units). Output: the phrase printed
   under document totals, e.g. "فقط تسعة وستون ريالًا سعوديًا لا غير".
   Arabic follows the counted-noun rules: 1 and 2 agree with the noun, 3–10 take the
   opposite gender and a plural noun, 11–99 an accusative singular, and a number ending
   in 00, 01 or 02 after a hundred a genitive singular. A number that ends exactly in
   مائتان/ألفان/مليونان/ملياران before its noun drops the nun of the dual (مائتا ريال،
   ألفا ريال). هللة is feminine; ريال and the scale nouns are masculine. */

const ONES = {
  m: ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة'],
  f: ['', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثماني', 'تسع', 'عشر'],
}
// Units inside 21–99 ("واحد وعشرون" / "إحدى وعشرون").
const UNITS = {
  m: ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'],
  f: ['', 'إحدى', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثماني', 'تسع'],
}
const TEENS = {
  m: ['أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'],
  f: ['إحدى عشرة', 'اثنتا عشرة', 'ثلاث عشرة', 'أربع عشرة', 'خمس عشرة', 'ست عشرة', 'سبع عشرة', 'ثماني عشرة', 'تسع عشرة'],
}
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']

const SCALES = [
  { value: 1e9, one: 'مليار', two: 'ملياران', twoConstruct: 'مليارا', few: 'مليارات', many: 'مليارًا' },
  { value: 1e6, one: 'مليون', two: 'مليونان', twoConstruct: 'مليونا', few: 'ملايين', many: 'مليونًا' },
  { value: 1e3, one: 'ألف', two: 'ألفان', twoConstruct: 'ألفا', few: 'آلاف', many: 'ألفًا' },
]

const RIYAL = { one: 'ريال سعودي', two: 'ريالان سعوديان', few: 'ريالات سعودية', many: 'ريالًا سعوديًا', single: 'ريال سعودي واحد' }
const HALALA = { one: 'هللة', two: 'هللتان', few: 'هللات', many: 'هللة', single: 'هللة واحدة' }

function below100(n, g) {
  if (n <= 10) return ONES[g][n]
  if (n < 20) return TEENS[g][n - 11]
  const u = n % 10
  const t = Math.floor(n / 10)
  return u ? `${UNITS[g][u]} و${TENS[t]}` : TENS[t]
}

/* 1–999. construct=true when the counted noun follows directly, so a bare 200 reads "مائتا". */
function below1000(n, g, construct) {
  const h = Math.floor(n / 100)
  const r = n % 100
  const parts = []
  if (h) parts.push(construct && !r && h === 2 ? 'مائتا' : HUNDREDS[h])
  if (r) parts.push(below100(r, g))
  return parts.join(' و')
}

/* A group (1–999) counting a masculine scale noun: ألف، ألفان، ثلاثة آلاف، أحد عشر ألفًا، مائة ألف… */
function scaleGroup(g, s, construct) {
  if (g === 1) return s.one
  if (g === 2) return construct ? s.twoConstruct : s.two
  const r = g % 100
  const words = below1000(g, 'm', true)
  if (r >= 3 && r <= 10) return `${words} ${s.few}`
  // Directly before the currency noun the scale noun is genitive (أحد عشر ألف ريال);
  // followed by more digits it is the accusative singular (أحد عشر ألفًا وخمسمائة).
  if (r >= 11) return `${words} ${construct ? s.one : s.many}`
  return `${words} ${s.one}`
}

/* Words for a positive whole number counting a noun of gender g. */
function numberWords(n, g) {
  const parts = []
  let rest = n
  for (const s of SCALES) {
    const q = Math.floor(rest / s.value)
    rest %= s.value
    if (q) parts.push({ q, s })
  }
  const out = parts.map(({ q, s }, i) => scaleGroup(q, s, !rest && i === parts.length - 1))
  if (rest) out.push(below1000(rest, g, true))
  return out.join(' و')
}

/* "<number> <noun>" with the counted-noun rule; 1 and 2 are said by the noun alone. */
function counted(n, g, noun) {
  if (n === 1) return noun.single
  if (n === 2) return noun.two
  const r = n % 100
  const words = numberWords(n, g)
  if (r >= 3 && r <= 10) return `${words} ${noun.few}`
  if (r >= 11) return `${words} ${noun.many}`
  return `${words} ${noun.one}`
}

function split(halalas) {
  if (!Number.isSafeInteger(halalas) || halalas < 0) throw new RangeError('amount must be a non-negative integer of halalas')
  if (halalas >= 1e14) throw new RangeError('amount too large')
  return { riyals: Math.floor(halalas / 100), halalas: halalas % 100 }
}

/** «فقط … لا غير» for an amount in halalas. */
export function amountInArabicWords(halalas) {
  const p = split(halalas)
  const parts = []
  if (p.riyals) parts.push(counted(p.riyals, 'm', RIYAL))
  if (p.halalas) parts.push(counted(p.halalas, 'f', HALALA))
  if (!parts.length) parts.push('صفر ريال سعودي')
  return `فقط ${parts.join(' و')} لا غير`
}

const EN_ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
]
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const EN_SCALES = [
  [1e9, 'Billion'],
  [1e6, 'Million'],
  [1e3, 'Thousand'],
]

function enBelow1000(n) {
  const h = Math.floor(n / 100)
  const r = n % 100
  const parts = []
  if (h) parts.push(`${EN_ONES[h]} Hundred`)
  if (r) parts.push(r < 20 ? EN_ONES[r] : EN_TENS[Math.floor(r / 10)] + (r % 10 ? `-${EN_ONES[r % 10]}` : ''))
  return parts.join(' ')
}

function enWords(n) {
  if (!n) return 'Zero'
  const out = []
  let rest = n
  for (const [v, name] of EN_SCALES) {
    const q = Math.floor(rest / v)
    rest %= v
    if (q) out.push(`${enBelow1000(q)} ${name}`)
  }
  if (rest) out.push(enBelow1000(rest))
  return out.join(' ')
}

/** "… Saudi Riyals Only" for an amount in halalas. */
export function amountInEnglishWords(halalas) {
  const p = split(halalas)
  const parts = []
  if (p.riyals || !p.halalas) parts.push(`${enWords(p.riyals)} Saudi ${p.riyals === 1 ? 'Riyal' : 'Riyals'}`)
  if (p.halalas) parts.push(`${enWords(p.halalas)} ${p.halalas === 1 ? 'Halala' : 'Halalas'}`)
  return `${parts.join(' and ')} Only`
}
