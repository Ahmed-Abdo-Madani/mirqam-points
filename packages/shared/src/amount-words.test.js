import { describe, expect, it } from 'vitest'
import { amountInArabicWords, amountInEnglishWords, COMPANY } from './index.js'

describe('amount in words (تفقيط), riyals', () => {
  it.each([
    [0, 'فقط صفر ريال سعودي لا غير', 'Zero Saudi Riyals Only'],
    [1, 'فقط ريال سعودي واحد لا غير', 'One Saudi Riyal Only'],
    [2, 'فقط ريالان سعوديان لا غير', 'Two Saudi Riyals Only'],
    [3, 'فقط ثلاثة ريالات سعودية لا غير', 'Three Saudi Riyals Only'],
    [10, 'فقط عشرة ريالات سعودية لا غير', 'Ten Saudi Riyals Only'],
    [11, 'فقط أحد عشر ريالًا سعوديًا لا غير', 'Eleven Saudi Riyals Only'],
    [21, 'فقط واحد وعشرون ريالًا سعوديًا لا غير', 'Twenty-One Saudi Riyals Only'],
    [69, 'فقط تسعة وستون ريالًا سعوديًا لا غير', 'Sixty-Nine Saudi Riyals Only'],
    [100, 'فقط مائة ريال سعودي لا غير', 'One Hundred Saudi Riyals Only'],
    [101, 'فقط مائة وواحد ريال سعودي لا غير', 'One Hundred One Saudi Riyals Only'],
    [103, 'فقط مائة وثلاثة ريالات سعودية لا غير', 'One Hundred Three Saudi Riyals Only'],
    [200, 'فقط مائتا ريال سعودي لا غير', 'Two Hundred Saudi Riyals Only'],
    [690, 'فقط ستمائة وتسعون ريالًا سعوديًا لا غير', 'Six Hundred Ninety Saudi Riyals Only'],
    [1000, 'فقط ألف ريال سعودي لا غير', 'One Thousand Saudi Riyals Only'],
    [2000, 'فقط ألفا ريال سعودي لا غير', 'Two Thousand Saudi Riyals Only'],
    [3000, 'فقط ثلاثة آلاف ريال سعودي لا غير', 'Three Thousand Saudi Riyals Only'],
    [11000, 'فقط أحد عشر ألف ريال سعودي لا غير', 'Eleven Thousand Saudi Riyals Only'],
    [2000000, 'فقط مليونا ريال سعودي لا غير', 'Two Million Saudi Riyals Only'],
    [
      1234567,
      'فقط مليون ومائتان وأربعة وثلاثون ألفًا وخمسمائة وسبعة وستون ريالًا سعوديًا لا غير',
      'One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven Saudi Riyals Only',
    ],
  ])('%i riyals', (riyals, ar, en) => {
    expect(amountInArabicWords(riyals * 100)).toBe(ar)
    expect(amountInEnglishWords(riyals * 100)).toBe(en)
  })

  it('reads the subscription prices from halalas', () => {
    expect(amountInArabicWords(6900)).toBe('فقط تسعة وستون ريالًا سعوديًا لا غير')
    expect(amountInArabicWords(69000)).toBe('فقط ستمائة وتسعون ريالًا سعوديًا لا غير')
    expect(amountInEnglishWords(69000)).toBe('Six Hundred Ninety Saudi Riyals Only')
  })
})

describe('amount in words (تفقيط), halalas', () => {
  it.each([
    [1, 'فقط هللة واحدة لا غير', 'One Halala Only'],
    [2, 'فقط هللتان لا غير', 'Two Halalas Only'],
    [3, 'فقط ثلاث هللات لا غير', 'Three Halalas Only'],
    [11, 'فقط إحدى عشرة هللة لا غير', 'Eleven Halalas Only'],
    [50, 'فقط خمسون هللة لا غير', 'Fifty Halalas Only'],
    [101, 'فقط ريال سعودي واحد وهللة واحدة لا غير', 'One Saudi Riyal and One Halala Only'],
    [250, 'فقط ريالان سعوديان وخمسون هللة لا غير', 'Two Saudi Riyals and Fifty Halalas Only'],
    [6210, 'فقط اثنان وستون ريالًا سعوديًا وعشر هللات لا غير', 'Sixty-Two Saudi Riyals and Ten Halalas Only'],
  ])('%i halalas', (halalas, ar, en) => {
    expect(amountInArabicWords(halalas)).toBe(ar)
    expect(amountInEnglishWords(halalas)).toBe(en)
  })

  it.each([-1, 1.5, Number.NaN, '100', null, 1e14])('rejects %s', (bad) => {
    expect(() => amountInArabicWords(bad)).toThrow(RangeError)
    expect(() => amountInEnglishWords(bad)).toThrow(RangeError)
  })
})

describe('company identity', () => {
  it('carries the registered facts and no VAT number', () => {
    expect(COMPANY.crNumber).toBe('7055011105')
    expect(COMPANY.legalName).toEqual({ ar: 'شركة مرقام التجارية', en: 'Mirqam Company Commercial' })
    expect(COMPANY.email).toBe('contact.bot@mirqam.sa')
    expect(Object.keys(COMPANY)).not.toContain('vatNumber')
    expect(Object.isFrozen(COMPANY)).toBe(true)
  })
})
