/* English — Mirqam Pager plan (pricing page and subscription card). Merged into en.js. Prices live in packages/shared/src/pager-plans.js. */
export default {
  pager: {
    kicker: 'Standalone product',
    title: 'Mirqam Pager',
    subtitle: 'Call your customer when the order is ready. No pager hardware and no app to install: a QR code and an alert on their phone.',
    monthly: 'Monthly',
    yearly: 'Yearly',
    perMonth: '/ branch / month',
    perYear: '/ branch / year',
    yearlyNote: 'Yearly costs ten months',
    vat: 'Prices exclude VAT (15%).',
    trial: '{days}-day free trial, no card',
    withLoyalty: 'With Mirqam Loyalty: {amount} / branch / month',
    withLoyaltyApplied: 'Mirqam Loyalty subscriber price',
    freeWithPos: 'Free with the Pro plan of Mirqam Mohasbi — ask us to switch it on',
    cta: 'Start the free trial',
    soon: 'Coming soon',
    tiers: { basic: 'Basic', plus: 'Plus' },
    features: {
      unlimitedCalls: 'Unlimited calls',
      webAlerts: 'Alerts on the order page and phone notifications',
      cashierApp: 'Cashier app in pager mode',
      qr: 'QR code for the counter and every order',
      tv: 'Order display screen',
      basicReports: 'Basic reports',
      branding: 'Your logo and colours',
      everythingInBasic: 'Everything in Basic',
      whatsappReady: '“Your order is ready” on WhatsApp',
      liveActivity: 'Alert on the iPhone lock screen',
      fullReports: 'Full reports and CSV export',
      multiBranch: 'One dashboard for all branches',
    },
    console: {
      title: 'Mirqam Pager',
      intro: 'A subscription of its own, separate from Mirqam Loyalty, per branch. It turns the pager on in the Mirqam Cashier app, even without the POS.',
      branches: 'Branches',
      total: 'Total before VAT: {amount}',
      startTrial: 'Start the free trial ({days} days)',
      subscribe: 'Subscribe',
      current: 'Your plan',
      until: 'Until {date}',
      status: {
        trialing: 'Free trial',
        active: 'Active',
        past_due: 'Payment due',
        suspended: 'Suspended',
        canceled: 'Canceled',
        expired: 'Ended',
      },
      posOn: 'The pager is on in the cashier app.',
      posPending: 'We are connecting the pager to the cashier app. This can take a few minutes.',
      posEmailInUse: 'Your email already has a Mirqam POS account. Turn the pager on from the POS console, or contact us to link the two.',
      unavailable: 'Payment is not available right now. Try again later or contact us.',
      stepsTitle: 'After you start',
      steps: {
        email: 'We email you a link to set the cashier account password.',
        branch: 'Add your branch and print the counter QR code.',
        app: 'Download the Mirqam Cashier app and sign in. It opens in pager mode.',
      },
    },
  },
  landing: {
    pager: {
      nav: 'Mirqam Pager',
      'new': 'New',
      soon: 'Coming soon',
      demoLabel: 'Illustrative preview',
      heroChip: "New · Mirqam Pager: your customer's phone is the pager",
      kicker: 'Mirqam Pager · New',
      title: "Your customer's phone is the pager.",
      subtitle:
        'Customers scan the QR on their receipt or at the counter, and their phone rings the moment the order is ready. No pager devices to hand out and collect, and no app to install.',
      chips: ['No hardware', 'No app for the customer', 'With Mirqam Mohasbi or on its own'],
      cta: {
        trial: 'Start your free trial',
        demo: 'Request a demo',
        whatsapp: 'Message us on WhatsApp',
        plans: 'See the plans',
        contactNote: "Online sign-up is coming soon. Contact us and we'll switch it on for you today.",
        whatsappText: 'I would like to know more about Mirqam Pager',
      },
      preview: {
        brand: 'Sample Café',
        order: 'Order',
        status: 'Preparing',
        ready: 'Your phone rings when your order is ready',
        receipt: 'Scan to follow your order',
      },
      steps: {
        title: 'From receipt to “ready” in three steps.',
        items: [
          {
            t: 'Scan the code',
            d: 'Every order has a QR on its receipt, and every branch has one at the counter.',
          },
          {
            t: 'Wait anywhere',
            d: 'A waiting page opens in the browser with the order number and status, in your logo and colours.',
          },
          {
            t: 'The phone rings',
            d: 'When the order is ready: a sound and a notification on the page, plus a WhatsApp “ready” message on Plus.',
          },
        ],
      },
      features: {
        title: 'Everything the pickup counter needs.',
        plus: 'Plus',
        items: [
          {
            t: 'Cashier and kitchen on the same order',
            d: 'The kitchen marks orders ready on the kitchen screen; the cashier calls, recalls and closes them from the Calls tab.',
          },
          {
            t: 'A TV call screen',
            d: 'Show ready order numbers on a screen at the pickup counter.',
          },
          {
            t: 'A WhatsApp “ready” message',
            d: 'Reaches the customer on WhatsApp as soon as the order is ready, even if they closed the page.',
          },
          {
            t: 'Counter reports',
            d: 'Number of calls, how many were collected and average preparation time. Plus adds full reports with export.',
          },
          {
            t: 'Your brand, two languages',
            d: "Your logo and colours on the customer's page, in Arabic and English.",
          },
          {
            t: 'With Mohasbi or on its own',
            d: 'With Mirqam Mohasbi every order creates its call automatically. Without it, the same cashier app opens in a simple pager-only mode.',
          },
        ],
      },
      liveCard: {
        t: 'Live card on the iPhone lock screen',
        d: 'Order status live on the lock screen. Not released yet; it joins Plus when it launches.',
      },
      plans: {
        title: 'Simple pricing, per branch.',
        subtitle: 'Basic and Plus, per branch, monthly or yearly. Yearly costs ten months.',
        inApp: "Prices and sign-up are on the Mirqam Loyalty website. Contact us and we'll set up the right plan.",
      },
      faq: {
        title: 'Pager questions',
        items: [
          {
            q: 'Does my customer need to install an app?',
            a: "No. They scan the code and the waiting page opens straight in their phone's browser.",
          },
          {
            q: 'Does it ring on a locked phone?',
            a: 'The waiting page alerts with a sound and a notification. On a locked iPhone, the reliable way today is the WhatsApp “ready” message on Plus; the lock-screen live card is coming soon.',
          },
          {
            q: 'Do I need Mirqam Mohasbi?',
            a: 'No. With Mohasbi every order creates its call automatically. Without it, you call orders from the Mirqam cashier app in a simple pager-only mode.',
          },
          {
            q: 'What do I need at the branch?',
            a: 'A phone or tablet with the Mirqam cashier app (iPhone or Android) and the counter QR printed at pickup. With a receipt printer, every receipt gets its own QR. The TV screen is optional.',
          },
          {
            q: 'How much is it, and is there a trial?',
            a: 'Basic is {basic} and Plus {plus} per branch a month, excluding VAT; yearly costs ten months. With Mirqam Loyalty they are {basicLoyalty} and {plusLoyalty} a month, and Basic is free with the Pro plan of Mirqam Mohasbi; we switch it on when you ask.',
          },
        ],
        trial: ' There is a {days}-day trial with no card.',
        priceInApp: {
          q: 'How much is it?',
          a: 'Basic and Plus have published per-branch prices, monthly or yearly, on the Mirqam Loyalty website. Basic is included in the Pro plan of Mirqam Mohasbi, and we switch it on when you ask.',
        },
      },
      footer: 'Mirqam Pager',
    },
  },
}
