/* Brand rule: Western digits (0–9) in all system UI, tabular for numbers. */
import { formatMinor } from '@mirqam-points/shared'

const intFmt = new Intl.NumberFormat('en-US')
export const num = (n) => (n == null ? '—' : intFmt.format(n))

export const money = (minor, locale) => (minor == null ? '—' : locale === 'ar' ? `${formatMinor(minor)} ر.س` : `SAR ${formatMinor(minor)}`)

const dateFmt = {
  ar: new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }),
  en: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
}
const dayFmt = {
  ar: new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { dateStyle: 'medium' }),
  en: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }),
}
export const dateTime = (iso, locale) => (iso ? dateFmt[locale].format(new Date(iso)) : '—')
export const day = (iso, locale) => (iso ? dayFmt[locale].format(new Date(iso)) : '—')

/** Signed amount with explicit +/− (points). */
export const signed = (n) => (n > 0 ? `+${num(n)}` : `−${num(Math.abs(n))}`)
