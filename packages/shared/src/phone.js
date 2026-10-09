/* Phone numbers are the member identity at the counter, so every entry point
   (cashier, console, API, enrollment) must agree on one canonical form: E.164.
   Saudi local formats are accepted because that is what customers say aloud. */

const E164 = /^\+[1-9]\d{6,14}$/

const ARABIC_INDIC = /[٠-٩۰-۹]/g

function toLatinDigits(value) {
  return value.replace(ARABIC_INDIC, (d) => String((d.charCodeAt(0) & 0xf) % 10))
}

/** Returns the E.164 form ("+9665XXXXXXXX") or null when the input is not a phone number. */
export function normalizePhone(input, defaultCountry = '966') {
  if (input == null) return null
  let s = toLatinDigits(String(input))
    .trim()
    .replace(/[\s\-().]/g, '')
  if (!s) return null
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  if (!s.startsWith('+')) {
    if (s.startsWith(defaultCountry)) s = `+${s}`
    else if (s.startsWith('0')) s = `+${defaultCountry}${s.slice(1)}`
    else if (/^5\d{8}$/.test(s) && defaultCountry === '966') s = `+966${s}`
    else return null
  }
  if (!E164.test(s)) return null
  // Saudi mobiles are exactly +9665 followed by 8 digits.
  if (s.startsWith('+966') && !/^\+9665\d{8}$/.test(s)) return null
  return s
}

export function isE164(value) {
  return typeof value === 'string' && E164.test(value)
}
