/* The build-time HTML of the public pages (prerender.jsx): what crawlers that do
   not run JavaScript get inside #root (apps/api/src/seo.js). */
import { INDEXABLE_PAGES, SITE_NAME } from '@mirqam-points/shared'
import { describe, expect, it } from 'vitest'
import { pages, renderPage } from './prerender.jsx'

describe('prerendered public pages', () => {
  it('covers every public page', () => {
    expect(pages.map((p) => p.path).sort()).toEqual(Object.keys(INDEXABLE_PAGES).sort())
  })

  for (const { page, path } of pages) {
    it(`${path}: one h1, the website's name, signed-out links, no broken values`, () => {
      const html = renderPage(page)
      expect(html.startsWith('<div data-prerendered="">')).toBe(true)
      expect(html.match(/<h1[\s>]/g), path).toHaveLength(1)
      expect(html).toContain(`aria-label="${SITE_NAME.ar}"`)
      expect(html).toContain('href="/login"')
      expect(html).not.toMatch(/\bundefined\b|\[object Object\]|href="[^"]*\/null"/)
      for (const img of html.match(/<img\b[^>]*>/g) || []) expect(img).toMatch(/\balt="/)
    })
  }

  it('the home page shows the store links its structured data names', () => {
    const html = renderPage('home')
    expect(html).toContain('https://apps.apple.com/sa/app/id6821140365')
    expect(html).toContain('https://play.google.com/store/apps/details?id=sa.mirqam.points')
  })
})
