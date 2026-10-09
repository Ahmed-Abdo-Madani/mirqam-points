/* Arabic-first i18n. All UI copy lives in ar.js / en.js — components call t().
   Locale drives <html lang dir>; the choice persists across Mirqam products
   via the shared `mirqam-locale` key. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import ar from './ar.js'
import en from './en.js'

export const dictionaries = { ar, en }
const STORAGE_KEY = 'mirqam-locale'

function lookup(dict, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dict)
}

export function translate(locale, key, vars) {
  let text = lookup(dictionaries[locale], key) ?? lookup(ar, key)
  if (typeof text !== 'string') {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`)
    return key
  }
  if (vars) text = text.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? `{${name}}`)
  return text
}

const I18nCtx = createContext(null)

function initialLocale() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ar'
  } catch {
    return 'ar'
  }
}

export function I18nProvider({ children }) {
  const [locale, setLocale] = useState(initialLocale)
  useEffect(() => {
    const html = document.documentElement
    html.lang = locale
    html.dir = locale === 'ar' ? 'rtl' : 'ltr'
    document.title = translate(locale, 'meta.title')
    try {
      localStorage.setItem(STORAGE_KEY, locale)
    } catch {
      /* storage is optional */
    }
  }, [locale])
  const t = useCallback((key, vars) => translate(locale, key, vars), [locale])
  const value = useMemo(() => ({ locale, setLocale, t, dir: locale === 'ar' ? 'rtl' : 'ltr' }), [locale, t])
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

export function useI18n() {
  return useContext(I18nCtx)
}

/** Maps an ApiError (server error code) to user-facing copy. */
export function useErrorText() {
  const { locale } = useI18n()
  return useCallback(
    (err) => {
      const code = err?.code
      if (code && typeof lookup(dictionaries[locale], `errors.${code}`) === 'string') return translate(locale, `errors.${code}`)
      return translate(locale, 'errors.generic')
    },
    [locale],
  )
}
