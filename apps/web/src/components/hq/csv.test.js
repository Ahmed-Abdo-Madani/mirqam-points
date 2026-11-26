import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from './csv.js'

describe('HQ CSV export', () => {
  it.each([
    ['plain', 'plain'],
    [42, '42'],
    [null, ''],
    ['مقهى السحاب', 'مقهى السحاب'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
  ])('quotes %j as %j', (value, out) => expect(csvCell(value)).toBe(out))

  it.each(['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])('neutralises the formula %j', (value) => {
    expect(csvCell(value).replace(/^"/, '')).toMatch(/^'/)
  })

  it('writes a BOM, CRLF rows and a trailing newline', () => {
    expect(toCsv([['a', 'b'], ['=1', 'c,d']])).toBe('﻿a,b\r\n\'=1,"c,d"\r\n')
  })
})
