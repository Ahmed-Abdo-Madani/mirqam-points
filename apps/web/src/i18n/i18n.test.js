/* Guards the "no hardcoded strings / no missing translations" rule:
   1. ar and en expose exactly the same keys.
   2. Every static t('key') used in the source exists.
   3. Every server error code the API can return has copy. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ar from './ar.js'
import en from './en.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..')
const API_SRC = join(HERE, '../../../api/src')

function keys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]))
}

function files(dir, re) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return files(full, re)
    return re.test(name) && !/\.test\.js$/.test(name) ? [full] : []
  })
}

const arKeys = new Set(keys(ar))

describe('i18n dictionaries', () => {
  it('ar and en have identical keys', () => {
    const enKeys = new Set(keys(en))
    expect([...arKeys].filter((k) => !enKeys.has(k))).toEqual([])
    expect([...enKeys].filter((k) => !arKeys.has(k))).toEqual([])
  })

  it('every static t() key used in the web app exists', () => {
    const used = new Set()
    for (const file of files(SRC, /\.(jsx?|mjs)$/)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1])
      // Also keys passed through ternaries: t(cond ? 'a.b' : 'c.d')
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\([^)]*?\?\s*'([a-zA-Z0-9_.]+)'\s*:\s*'([a-zA-Z0-9_.]+)'/g)) {
        used.add(m[1])
        used.add(m[2])
      }
    }
    expect([...used].filter((k) => !arKeys.has(k))).toEqual([])
  })

  it('every API error code has user-facing copy', () => {
    const codes = new Set()
    for (const file of [...files(API_SRC, /\.js$/), join(HERE, '../../../../packages/shared/src/earn.js')]) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/(?:HttpError\(\d+, |LedgerError\(|error: )'([a-z_]+)'/g)) codes.add(m[1])
    }
    expect(codes.size).toBeGreaterThan(15)
    expect([...codes].filter((c) => !arKeys.has(`errors.${c}`))).toEqual([])
  })
})
