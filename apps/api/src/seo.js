/* Server-rendered <head> for the console's HTML shell (apps/web/index.html).
   The console is a single-page app, so without this every URL would answer
   200 with the same title and no canonical. Per path (packages/shared/src/seo.js):
     - public pages (/, /privacy, /terms, /support, /delete-account): their own
       title, description, canonical, Open Graph / Twitter card and JSON-LD, and
       their content prerendered at build time (scripts/prerender-public.mjs)
       inside #root, so crawlers that do not run JavaScript see the page;
     - private routes (sign-in, dashboards, a member's card): noindex, also as
       an X-Robots-Tag header;
     - a public page with a trailing slash: 301 to its one address;
     - anything else: a real 404 (the shell still renders the "not found" page).
   Search-console verification tags are added to every HTML document only when
   GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION are set. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_NAME, classifyPath, INDEXABLE_PAGES, OG_IMAGE, SITE_NAME, SITE_URL, seoCopy } from '@mirqam-points/shared'

const ROBOTS_INDEX = 'index,follow,max-image-preview:large'
const ROBOTS_NOINDEX = 'noindex,nofollow'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// JSON inside <script>: never let a value close the tag.
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`

/** Build-time HTML of the public pages (webDist/prerender/<page>.html), keyed by page. Pages
    without a file are left out: their shell is served empty, as before. */
export function loadPrerendered(webDist) {
  const out = {}
  for (const page of Object.values(INDEXABLE_PAGES)) {
    const file = join(webDist, 'prerender', `${page}.html`)
    if (existsSync(file)) out[page] = readFileSync(file, 'utf8')
  }
  return out
}

/** <meta> verification tags, empty unless the env vars are set. */
export function verificationTags(config) {
  const v = config.siteVerification || {}
  return [
    v.google ? `<meta name="google-site-verification" content="${esc(v.google)}" />` : '',
    v.bing ? `<meta name="msvalidate.01" content="${esc(v.bing)}" />` : '',
  ].join('')
}

function structuredData(page, copy, url) {
  const organization = {
    '@type': 'Organization',
    '@id': 'https://mirqam.sa/#organization',
    name: 'مرقام',
    alternateName: 'Mirqam',
    url: 'https://mirqam.sa/',
    logo: `${SITE_URL}/brand/mirqam-logo-512.png`,
  }
  if (page === 'home') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        organization,
        {
          '@type': 'WebSite',
          '@id': `${SITE_URL}/#website`,
          name: SITE_NAME.ar,
          alternateName: SITE_NAME.en,
          url: `${SITE_URL}/`,
          inLanguage: 'ar',
          publisher: { '@id': organization['@id'] },
        },
        {
          '@type': 'SoftwareApplication',
          name: SITE_NAME.ar,
          // The merchant app is listed in the stores as «مرقام نقاط» / Mirqam Points.
          alternateName: [SITE_NAME.en, APP_NAME.ar, APP_NAME.en],
          url: `${SITE_URL}/`,
          description: copy.description,
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web, iOS, Android',
          inLanguage: ['ar', 'en'],
          publisher: { '@id': organization['@id'] },
          sameAs: ['https://apps.apple.com/sa/app/id6821140365', 'https://play.google.com/store/apps/details?id=sa.mirqam.points'],
        },
      ],
    }
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME.ar, item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: copy.title.split(' | ')[0], item: url },
    ],
  }
}

/** The shell for `path`: { status, robots, html }, or { status: 301, location } for a
    public page asked with a trailing slash. `html` is the built index.html;
    `prerendered` maps a public page's key to its build-time HTML (may be empty). */
export function renderShell(html, path, config, prerendered = {}) {
  const { status, indexable, page, location } = classifyPath(path)
  if (status === 301) return { status, location, robots: null, html: null }
  let head = verificationTags(config)
  let out = html
  if (indexable) {
    const copy = seoCopy.ar[page]
    // The page's own address (never the request's spelling of it).
    const url = `${SITE_URL}${Object.keys(INDEXABLE_PAGES).find((p) => INDEXABLE_PAGES[p] === page)}`
    // Function replacers: a `$` in the inserted text must never act as a replacement pattern.
    out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(copy.title)}</title>`)
    out = out.replace(/<meta name="description" content="[^"]*"\s*\/?>/, () => `<meta name="description" content="${esc(copy.description)}" />`)
    head +=
      `<meta name="robots" content="${ROBOTS_INDEX}" />` +
      `<link rel="canonical" href="${url}" />` +
      '<meta property="og:type" content="website" />' +
      `<meta property="og:site_name" content="${esc(SITE_NAME.ar)}" />` +
      '<meta property="og:locale" content="ar_SA" />' +
      `<meta property="og:title" content="${esc(copy.title)}" />` +
      `<meta property="og:description" content="${esc(copy.description)}" />` +
      `<meta property="og:url" content="${url}" />` +
      `<meta property="og:image" content="${OG_IMAGE.url}" />` +
      `<meta property="og:image:width" content="${OG_IMAGE.width}" />` +
      `<meta property="og:image:height" content="${OG_IMAGE.height}" />` +
      `<meta property="og:image:alt" content="${esc(OG_IMAGE.alt)}" />` +
      '<meta name="twitter:card" content="summary_large_image" />' +
      `<meta name="twitter:title" content="${esc(copy.title)}" />` +
      `<meta name="twitter:description" content="${esc(copy.description)}" />` +
      `<meta name="twitter:image" content="${OG_IMAGE.url}" />` +
      jsonLd(structuredData(page, copy, url))
    // The page itself, for crawlers without JavaScript; the app replaces it on start.
    if (prerendered[page]) out = out.replace('<div id="root"></div>', () => `<div id="root">${prerendered[page]}</div>`)
  } else {
    head += `<meta name="robots" content="${ROBOTS_NOINDEX}" />`
  }
  return { status, robots: indexable ? null : ROBOTS_NOINDEX, html: out.replace('</head>', () => `${head}</head>`) }
}
