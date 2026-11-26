/* HQ dates are Riyadh business dates on the Gregorian calendar with Western digits, whatever
   the administrator's browser time zone. Money is integer halalas, formatted without floats. */
import { formatMinor } from '@mirqam-points/shared'
import { money } from '../../lib/format.js'

const zone = { timeZone: 'Asia/Riyadh' }
const tag = { ar: 'ar-SA-u-nu-latn-ca-gregory', en: 'en-GB-u-ca-gregory' }
const fmt = (style) => ({
  ar: new Intl.DateTimeFormat(tag.ar, { ...zone, ...style }),
  en: new Intl.DateTimeFormat(tag.en, { ...zone, ...style }),
})
const days = fmt({ dateStyle: 'medium' })
const stamps = fmt({ dateStyle: 'medium', timeStyle: 'short' })
const iso = new Intl.DateTimeFormat('en-CA', { ...zone, year: 'numeric', month: '2-digit', day: '2-digit' })

export const hqDay = (value, locale) => (value ? days[locale].format(new Date(value)) : '—')
export const hqDateTime = (value, locale) => (value ? stamps[locale].format(new Date(value)) : '—')
/** YYYY-MM-DD in Riyadh, for exports. */
export const isoDay = (value) => (value ? iso.format(new Date(value)) : '')
/** Halalas in their currency; SAR uses the console's money format. */
export const amount = (minor, currency, locale) =>
  minor == null ? '—' : currency === 'SAR' || !currency ? money(minor, locale) : `${currency} ${formatMinor(minor)}`
