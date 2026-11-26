#!/usr/bin/env node
/* Writes the build-time HTML of the public pages to apps/web/dist/prerender/<page>.html
   (apps/web/src/prerender.jsx), which the API serves inside #root for crawlers
   that do not run JavaScript (apps/api/src/seo.js). Run by the web build after
   `vite build` and `vite build --ssr src/prerender.jsx --outDir dist-ssr`.
   Fails the build when a page does not render to exactly one <h1> with real content. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web')
const { pages, renderPage } = await import(pathToFileURL(join(WEB, 'dist-ssr', 'prerender.js')).href)
const out = join(WEB, 'dist', 'prerender')
mkdirSync(out, { recursive: true })

const problems = []
for (const { page, path } of pages) {
  const html = renderPage(page)
  const h1 = (html.match(/<h1[\s>]/g) || []).length
  if (h1 !== 1) problems.push(`${path}: ${h1} <h1> elements, expected 1`)
  if (/\bundefined\b|\[object Object\]|href="[^"]*\/null"/.test(html)) problems.push(`${path}: "undefined", "[object Object]" or a /null link in the markup`)
  if (html.length < 2000) problems.push(`${path}: only ${html.length} characters of markup`)
  writeFileSync(join(out, `${page}.html`), html)
}
if (problems.length) {
  console.error(`[prerender] refusing the build:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`[prerender] ${pages.length} public pages -> apps/web/dist/prerender/`)
