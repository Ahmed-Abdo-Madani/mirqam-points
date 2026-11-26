/* Search metadata of the public pages, shared by the API (server-rendered
   <head>, apps/api/src/seo.js) and the console (document.title on client-side
   navigation). The web dictionaries re-export the copy as `meta.pages`, so the
   i18n test keeps both languages in step. Titles ≤ 60 characters,
   descriptions ≤ 160 (seo.test.js). */

export const SITE_URL = 'https://loyalty.mirqam.sa'

/* The share image (apps/web/public/og-image.png, scripts/gen-web-icons.mjs) and its text. */
export const OG_IMAGE = {
  url: `${SITE_URL}/og-image.png`,
  width: 1200,
  height: 630,
  alt: 'مرقام نقاط: بطاقات نقاط وأختام وهدايا في محفظة جوال عميلك، على Apple Wallet وGoogle Wallet',
}

export const seoCopy = {
  ar: {
    home: {
      title: 'مرقام نقاط | برامج الولاء وبطاقات الهدايا',
      description: 'بطاقات نقاط وأختام وهدايا لمتجرك في Apple Wallet وGoogle Wallet، يتحدث رصيدها مع كل عملية شراء، دون تطبيق يحمّله عميلك.',
    },
    privacy: {
      title: 'سياسة الخصوصية | مرقام نقاط',
      description: 'ما البيانات التي يحفظها مرقام نقاط عن المتاجر وعملائها، ولماذا، وكيف نحميها، وكيف تطلب حذفها.',
    },
    terms: {
      title: 'الشروط والأحكام | مرقام نقاط',
      description: 'شروط استخدام مرقام نقاط للمتاجر وعملائها: الخدمة، والنقاط والأختام، وبطاقات الهدايا، والحسابات، والمسؤولية.',
    },
    support: {
      title: 'الدعم | مرقام نقاط',
      description: 'طرق التواصل مع فريق مرقام نقاط، وإجابات عن رصيد البطاقة وفقدانها وحذف الحساب.',
    },
    deleteAccount: {
      title: 'حذف الحساب | مرقام نقاط',
      description: 'كيف تحذف حساب متجرك في مرقام نقاط من التطبيق أو الموقع أو بالبريد، وما الذي يُحذف وما نحتفظ به ومدة ذلك.',
    },
  },
  en: {
    home: {
      title: 'Mirqam Points | Loyalty programs & gift cards',
      description:
        'Points, stamp and gift cards for your store in Apple Wallet and Google Wallet. Balances update with every purchase; customers install no app.',
    },
    privacy: {
      title: 'Privacy Policy | Mirqam Points',
      description: 'What data Mirqam Points keeps about merchants and their customers, why, how it is protected, and how to ask for deletion.',
    },
    terms: {
      title: 'Terms of Service | Mirqam Points',
      description: 'Terms for merchants and their customers using Mirqam Points: the service, points and stamps, gift cards, accounts and liability.',
    },
    support: {
      title: 'Support | Mirqam Points',
      description: 'How to reach the Mirqam Points team, and answers about card balances, lost cards and deleting your account.',
    },
    deleteAccount: {
      title: 'Delete your account | Mirqam Points',
      description: 'How to delete your Mirqam Points store account in the app, on the website or by email, what is deleted, what is kept and for how long.',
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

/** Classifies a console path: { status: 200 | 301 | 404, indexable, page } (page = copy key or null).
    A public page asked for with a trailing slash answers 301 to its one address (`location`). */
export function classifyPath(path) {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path
  const page = INDEXABLE_PAGES[p] || null
  if (page && p !== path) return { status: 301, indexable: false, page, location: p }
  if (page) return { status: 200, indexable: true, page }
  if (PRIVATE_ROUTES.some((re) => re.test(p))) return { status: 200, indexable: false, page: null }
  return { status: 404, indexable: false, page: null }
}
