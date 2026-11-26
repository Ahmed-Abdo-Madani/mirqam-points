/* Search metadata of the public pages, shared by the API (server-rendered
   <head>, apps/api/src/seo.js) and the console (document.title on client-side
   navigation). The web dictionaries re-export the copy as `meta.pages`, so the
   i18n test keeps both languages in step. */

export const SITE_URL = 'https://loyalty.mirqam.sa'

/* The website's name, as mirqam.sa lists the product. The merchant app in the
   stores is «مرقام نقاط» / Mirqam Points; pages that are about the app (the
   Google Play deletion page, the legal texts) keep naming it. */
export const SITE_NAME = { ar: 'مرقام ولاء', en: 'Mirqam Loyalty' }
export const APP_NAME = { ar: 'مرقام نقاط', en: 'Mirqam Points' }

/* Title of the website's not-found page (a real 404 since apps/api/src/seo.js). */
export const NOT_FOUND_TITLE = { ar: 'الصفحة غير موجودة | مرقام ولاء', en: 'Page not found | Mirqam Loyalty' }

/* The share image (apps/web/public/og-image.png, scripts/gen-web-icons.mjs) and its text. */
export const OG_IMAGE = {
  url: `${SITE_URL}/og-image.png`,
  width: 1200,
  height: 630,
  alt: 'مرقام ولاء: بطاقات نقاط وأختام وهدايا في محفظة جوال عميلك، على Apple Wallet وGoogle Wallet',
}

/* Titles <= 60 characters, descriptions 120-160 (seo.test.js). */
export const seoCopy = {
  ar: {
    home: {
      title: 'مرقام ولاء | بطاقات نقاط وأختام وهدايا في محفظة الجوال',
      description: 'أنشئ لمتجرك بطاقات نقاط وأختام وهدايا يضيفها عميلك إلى Apple Wallet وGoogle Wallet، ويتحدث رصيدها مع كل عملية شراء دون تطبيق يحمّله.',
    },
    privacy: {
      title: 'سياسة الخصوصية | مرقام ولاء',
      description: 'سياسة خصوصية مرقام ولاء: البيانات التي نحفظها عن المتاجر وعملائها، ولماذا نستخدمها، ومع من نشاركها، وكيف نحميها، وكيف تطلب حذفها.',
    },
    terms: {
      title: 'الشروط والأحكام | مرقام ولاء',
      description:
        'شروط استخدام مرقام ولاء للمتاجر وعملائها: الخدمة، وقواعد النقاط والأختام، وبطاقات الهدايا، والحسابات، وحدود المسؤولية، وطريقة التواصل معنا.',
    },
    support: {
      title: 'الدعم | مرقام ولاء',
      description: 'راسل فريق مرقام ولاء بالبريد ونرد خلال يوم عمل. إجابات لعملاء المتاجر عن الرصيد وفقدان البطاقة، ولأصحاب المتاجر عن البدء وحذف الحساب.',
    },
    deleteAccount: {
      title: 'حذف الحساب في تطبيق مرقام نقاط | مرقام ولاء',
      description: 'طريقة حذف حسابك في تطبيق مرقام نقاط من التطبيق أو الموقع أو بالبريد، وما الذي يُحذف وما نحتفظ به ولماذا، والمدة، وحذف بيانات عملاء المتاجر.',
    },
  },
  en: {
    home: {
      title: 'Mirqam Loyalty | Points, stamp and gift cards in the wallet',
      description:
        'Give your store points, stamp and gift cards that customers add to Apple Wallet or Google Wallet. Balances update with every purchase; no app to install.',
    },
    privacy: {
      title: 'Privacy Policy | Mirqam Loyalty',
      description:
        'Mirqam Loyalty privacy policy: what we keep about merchants and their customers, why we use it, who we share it with, how we protect it and how to delete it.',
    },
    terms: {
      title: 'Terms of Service | Mirqam Loyalty',
      description:
        'Terms for merchants and their customers using Mirqam Loyalty: the service, points and stamp rules, gift cards, accounts, liability and how to reach us.',
    },
    support: {
      title: 'Support | Mirqam Loyalty',
      description:
        'Email the Mirqam Loyalty team and get a reply within one business day. Answers for customers on balances and lost cards, and for merchants on getting started.',
    },
    deleteAccount: {
      title: 'Delete your Mirqam Points account | Mirqam Loyalty',
      description:
        'How to delete your Mirqam Points account in the app, on the website or by email: what is deleted, what we keep and why, how long it takes, and customer data.',
    },
  },
}

/* Public, indexable documents of the console → their copy key. */
export const INDEXABLE_PAGES = {
  '/': 'home',
  '/privacy': 'privacy',
  '/terms': 'terms',
  '/support': 'support',
  '/delete-account': 'deleteAccount',
}

/* Every other path the console's router renders (apps/web/src/App.jsx). They
   are private (sign-in, dashboards, a member's own card): served, but noindex. */
const PRIVATE_ROUTES = [/^\/(login|register|hq-entry|hq-admin)$/, /^\/app(\/.*)?$/, /^\/p\/[^/]+$/, /^\/gift\/[^/]+$/, /^\/join\/[^/]+\/[^/]+$/]

/* No page or resource here has an address this long. Longer paths are answered 404 at
   once (apps/api/src/http.js) instead of being routed, decoded or classified. */
export const MAX_PATH_LENGTH = 2048

/** `path` without its trailing slashes ('/' stays '/'). A loop, not /\/+$/: that regex
    backtracks quadratically on long runs of slashes, a cheap way to stall the server. */
export function trimTrailingSlashes(path) {
  let end = path.length
  while (end > 1 && path.charCodeAt(end - 1) === 47) end--
  return end === path.length ? path : path.slice(0, end)
}

/** Classifies a console path: { status: 200 | 301 | 404, indexable, page } (page = copy key or null).
    A public page asked for with a trailing slash answers 301 to its one address (`location`). */
export function classifyPath(path) {
  if (path.length > MAX_PATH_LENGTH) return { status: 404, indexable: false, page: null }
  const p = trimTrailingSlashes(path)
  const page = INDEXABLE_PAGES[p] || null
  if (page && p !== path) return { status: 301, indexable: false, page, location: p }
  if (page) return { status: 200, indexable: true, page }
  if (PRIVATE_ROUTES.some((re) => re.test(p))) return { status: 200, indexable: false, page: null }
  return { status: 404, indexable: false, page: null }
}
