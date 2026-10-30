/* Legal & support copy (data, rendered by Legal.jsx and DeleteAccount.jsx).
   Keep both languages in step. Describes what the product actually stores —
   update it whenever the schema gains personal data, and keep the deletion
   page in step with apps/api/src/account-deletion.js. Have counsel review
   before wide launch. */
import ar from '../../i18n/ar.js'
import en from '../../i18n/en.js'

const company = {
  ar: 'شركة مرقام التجارية، السجل التجاري 7055011105، مبنى 8145، شارع المصيف 54، حي المصيف، حفر الباطن 39913، المملكة العربية السعودية',
  en: 'Mirqam Company Commercial, CR No. 7055011105, Building 8145, Al Masif 54 St., Al Masif Dist., Hafar Al Batin 39913, Kingdom of Saudi Arabia',
}
export const CONTACT_EMAIL = 'contact.bot@mirqam.sa'
export const DELETE_ACCOUNT_PATH = '/delete-account'
// The public website (DNS: loyalty CNAME mirqam-points.onrender.com).
const SITE = 'loyalty.mirqam.sa'
const deletionLink = {
  ar: { to: DELETE_ACCOUNT_PATH, label: 'خطوات حذف الحساب وما يُحذف' },
  en: { to: DELETE_ACCOUNT_PATH, label: 'How to delete an account, and what is deleted' },
}

export default {
  privacy: {
    ar: {
      title: 'سياسة الخصوصية',
      updated: 'آخر تحديث: 30 أكتوبر 2026',
      sections: [
        [
          'من نحن',
          `مرقام نقاط منصة برامج ولاء وبطاقات هدايا تشغّلها ${company.ar}. نعمل «معالجاً» لبيانات عملاء المتاجر التي تستخدم المنصة، والمتجر هو «المتحكم» في تلك البيانات وفق نظام حماية البيانات الشخصية.`,
        ],
        [
          'البيانات التي نجمعها',
          'لحسابات أصحاب المتاجر وموظفيهم: الاسم والبريد الإلكتروني وكلمة المرور (مخزّنة بشكل مُشفّر لا يمكن استرجاعه). للمتجر: شعاره وصور الأختام التي يرفعها، وتظهر على بطاقات عملائه، ورقم واتساب اختياري لتذكيرات الاشتراك. لأعضاء برامج الولاء: رقم الجوال، والاسم والبريد إن قدّمهما العضو، وموافقة التسويق ووقتها، وسجل النقاط والأختام. لبطاقات الهدايا: القيمة والرصيد وسجل الاستخدام واسم المستلم ورقمه إن أُدخلا. عند إضافة البطاقة إلى Apple Wallet: معرّف الجهاز ورمز الإشعارات اللذان يرسلهما الجهاز لتحديث البطاقة. تطبيق الجوال يرسل عند فتحه إصداره وإصدار نظام التشغيل ومعرّفاً للجهاز ينشئه التطبيق، ليتحقق من وجود تحديث لشاشاته من خادمنا (خدمة تحديثات Capgo مستضافة لدينا)؛ نستخدمها للرد فقط ولا نخزّنها. تُستخدم الكاميرا لمسح البطاقات فقط ولا تُحفظ صورها. لا نجمع بيانات الموقع ولا جهات الاتصال.',
        ],
        [
          'كيف نستخدمها',
          'لتشغيل البرنامج فقط: احتساب النقاط واستبدالها، وإظهار البطاقة وتحديث رصيدها في محفظة الجوال، وإرسال رسائل البريد الخاصة بالحساب والاشتراك، وحماية الحسابات من إساءة الاستخدام. لا نبيع البيانات ولا نستخدمها للإعلانات. لا تُرسل رسائل تسويقية إلا لمن وافق صراحةً.',
        ],
        [
          'المشاركة',
          'تُشارك البيانات اللازمة لعرض البطاقة مع Apple وGoogle عند إضافة العضو بطاقته إلى محفظته بنفسه، ومع مزوّد الاستضافة (Render) لتشغيل الخدمة، ومع Resend لإرسال رسائل البريد إلى صاحب المتجر (عنوانه ونص الرسالة)، ومع Moyasar لمعالجة دفع الاشتراك على الموقع (لا نخزّن أرقام البطاقات). لا مشاركة أخرى إلا بأمر نظامي.',
        ],
        [
          'الاحتفاظ والحذف',
          'تُحفظ البيانات ما دام الحساب نشطاً. يحذف صاحب الحساب حسابه من التطبيق أو الموقع (الإعدادات ← حذف الحساب) أو بمراسلتنا. حذف المالك الوحيد يحذف فوراً بيانات المتجر كلها: الأعضاء وسجل النقاط والبرامج والحملات وبطاقات الهدايا وحسابات الموظفين والشعار وتسجيلات بطاقات المحفظة. نحتفظ بفواتير الاشتراك وسجلات الدفع فقط ست سنوات كما يلزم نظام ضريبة القيمة المضافة، ثم نحذفها، وتُستبدل النسخ الاحتياطية المشفرة خلال 7 أيام. يستطيع المتجر حذف بيانات أي عضو بطلب منه من صفحة العضو، ويمكن للعضو أيضاً طلب الاطلاع على بياناته أو تصحيحها أو حذفها بمراسلتنا.',
          deletionLink.ar,
        ],
        ['الأمان', 'الاتصال مشفّر (HTTPS)، وكلمات المرور مُجزّأة، ورموز بطاقات الهدايا مشفّرة أثناء التخزين، وسجل النقاط غير قابل للتعديل.'],
        ['التواصل', `لأي سؤال أو طلب يتعلق بالخصوصية: ${CONTACT_EMAIL}`],
      ],
    },
    en: {
      title: 'Privacy Policy',
      updated: 'Last updated: 30 October 2026',
      sections: [
        [
          'Who we are',
          `Mirqam Points is a loyalty and gift-card platform operated by ${company.en}. We act as a processor of the personal data of the stores' customers; each store is the controller of that data under the Saudi Personal Data Protection Law (PDPL).`,
        ],
        [
          'What we collect',
          'For store owners and staff: name, email and password (stored as a one-way hash). For the store: the logo and stamp images it uploads, shown on its customers’ cards, and an optional WhatsApp number for subscription reminders. For loyalty members: mobile number, name and email if provided, marketing consent and its time, and points/stamps history. For gift cards: value, balance, usage history and, if entered, the recipient’s name and number. When a card is added to Apple Wallet: the device identifier and push token the device sends so the card can update. When the mobile app opens it sends its version, the operating-system version and a device identifier the app generates, to check our server for updates to its screens (Capgo updates, hosted by us); we use them only to answer and do not store them. The camera is used only to scan cards; no images are kept. We do not collect location or contacts.',
        ],
        [
          'How we use it',
          'Only to run the program: earning and redeeming, showing the card and keeping its balance current in the phone wallet, sending account and subscription emails, and protecting accounts from abuse. We do not sell data or use it for advertising. Marketing messages are sent only to members who explicitly opted in.',
        ],
        [
          'Sharing',
          'Data needed to display a card is shared with Apple or Google when the member chooses to add the card to their wallet; with our hosting provider (Render) to run the service; with Resend to deliver emails to store owners (their address and the message); and with Moyasar to process subscription payments on the website (we never store card numbers). Nothing else, unless required by law.',
        ],
        [
          'Retention and deletion',
          'Data is kept while the account is active. Account holders delete their account in the app or on the website (Settings → Delete account), or by emailing us. When the only owner deletes their account, all of the store’s data is deleted immediately: members, points history, programs, campaigns, gift cards, staff accounts, the logo and wallet-card registrations. We keep only subscription invoices and payment records, for six years as Saudi VAT rules require, then delete them; encrypted backups are overwritten within 7 days. A store can delete any member’s data at their request from the member’s page, and members can also email us to access, correct or delete their data.',
          deletionLink.en,
        ],
        ['Security', 'Connections are encrypted (HTTPS), passwords are hashed, gift-card codes are encrypted at rest, and the points ledger cannot be edited.'],
        ['Contact', `Privacy questions and requests: ${CONTACT_EMAIL}`],
      ],
    },
  },
  terms: {
    ar: {
      title: 'الشروط والأحكام',
      updated: 'آخر تحديث: 9 أكتوبر 2026',
      sections: [
        [
          'الخدمة',
          `تقدّم ${company.ar} منصة لإدارة برامج الولاء وبطاقات الهدايا للمتاجر. كل متجر مسؤول عن قواعد برنامجه ومكافآته وعن البضائع والخدمات التي يقدمها.`,
        ],
        [
          'النقاط والأختام',
          'تُكتسب النقاط والأختام وتُستبدل لدى المتجر المصدر فقط وفق قواعده، وليس لها قيمة نقدية ولا تُحوّل. يحق للمتجر تصحيح الأرصدة الخاطئة، ويُسجَّل كل تصحيح مع سببه.',
        ],
        [
          'بطاقات الهدايا',
          'بطاقة الهدية قيمة مدفوعة مسبقاً لدى المتجر المصدر فقط، لا تُستبدل نقداً إلا إذا ألزم النظام بذلك. الرابط والرمز يعادلان البطاقة: احتفظ بهما. يحق للمتجر تجميد البطاقة عند الاشتباه بإساءة الاستخدام.',
        ],
        ['الحسابات', 'أنت مسؤول عن سرية كلمة المرور وعن صلاحيات موظفيك. يمكنك حذف حسابك في أي وقت من الإعدادات.'],
        ['المسؤولية', 'نبذل عناية معقولة لاستمرار الخدمة ودقتها، ولا نتحمل الأضرار غير المباشرة. تخضع هذه الشروط لأنظمة المملكة العربية السعودية.'],
        ['التواصل', CONTACT_EMAIL],
      ],
    },
    en: {
      title: 'Terms of Service',
      updated: 'Last updated: 9 October 2026',
      sections: [
        [
          'The service',
          `${company.en} provides a platform for stores to run loyalty programs and gift cards. Each store is responsible for its program rules, rewards, and the goods and services it sells.`,
        ],
        [
          'Points and stamps',
          'Points and stamps are earned and redeemed only at the issuing store under its rules. They have no cash value and are not transferable. Stores may correct wrong balances; every correction is recorded with its reason.',
        ],
        [
          'Gift cards',
          'A gift card is prepaid value at the issuing store only and is not exchangeable for cash unless the law requires it. The card link and code are equivalent to the card — keep them safe. Stores may freeze a card when misuse is suspected.',
        ],
        [
          'Accounts',
          'You are responsible for keeping your password secret and for your staff’s permissions. You can delete your account at any time from Settings.',
        ],
        [
          'Liability',
          'We take reasonable care to keep the service available and accurate and are not liable for indirect losses. These terms are governed by the laws of the Kingdom of Saudi Arabia.',
        ],
        ['Contact', CONTACT_EMAIL],
      ],
    },
  },
  support: {
    ar: {
      title: 'الدعم',
      updated: '',
      sections: [
        ['تواصل معنا', `راسلنا على ${CONTACT_EMAIL} ونرد خلال يوم عمل.`],
        [
          'لعملاء المتاجر',
          'لأسئلة الرصيد أو البطاقة، تواصل مع المتجر أولاً — فهو من يدير برنامجه. إن ضاعت بطاقتك فاطلب من المتجر «إعادة إصدار» البطاقة لتعطيل القديمة.',
        ],
        ['لأصحاب المتاجر', 'أنشئ حساباً، ثم برنامجاً، وفعّله، وابدأ من شاشة الكاشير.'],
        ['حذف الحساب', `من التطبيق أو الموقع: الإعدادات ← حذف الحساب ← حذف حسابي. أو راسلنا من بريد حسابك على ${CONTACT_EMAIL}.`, deletionLink.ar],
      ],
    },
    en: {
      title: 'Support',
      updated: '',
      sections: [
        ['Contact us', `Email ${CONTACT_EMAIL} — we reply within one business day.`],
        [
          'Store customers',
          'For balance or card questions, contact the store first — it runs its own program. If you lose your card, ask the store to “reissue” it so the old one stops working.',
        ],
        ['Store owners', 'Create an account, create and activate a program, and start from the cashier screen.'],
        [
          'Deleting an account',
          `In the app or on the website: Settings → Delete account → Delete my account. Or email us from your account’s address at ${CONTACT_EMAIL}.`,
          deletionLink.en,
        ],
      ],
    },
  },
  /* /delete-account — the public account-deletion page (Google Play). Both
     languages are shown together, Arabic first. The in-app labels are read
     from the dictionaries so the steps always match the screens. */
  deleteAccount: {
    ar: {
      title: 'حذف الحساب',
      app: 'مرقام نقاط',
      developer: 'المطوّر: مرقام',
      intro: 'تشرح هذه الصفحة كيف تحذف حسابك في تطبيق «مرقام نقاط» (Mirqam Points) وموقعه، من تطوير «مرقام» (Mirqam)، وما الذي يُحذف وما الذي نحتفظ به ولماذا.',
      sections: [
        {
          heading: 'من داخل التطبيق',
          steps: [
            'افتح تطبيق مرقام نقاط وسجّل الدخول بحسابك.',
            `افتح القائمة واختر «${ar.nav.settings}».`,
            `في بطاقة «${ar.settings.deleteTitle}» اضغط «${ar.settings.deleteButton}».`,
            `أدخل كلمة المرور ثم اضغط «${ar.settings.deleteForever}». إن كنت تدخل بحساب Google أو GitHub فأعد الدخول به كما تطلب الشاشة، ثم أكّد الحذف.`,
          ],
        },
        {
          heading: 'من الموقع',
          steps: [
            `سجّل الدخول على ${SITE}.`,
            `اتبع المسار نفسه: «${ar.nav.settings}» ← «${ar.settings.deleteTitle}» ← «${ar.settings.deleteButton}» ← «${ar.settings.deleteForever}».`,
          ],
        },
        {
          heading: 'بالبريد الإلكتروني',
          body: `إن لم تستطع الدخول، راسلنا من البريد المسجّل في حسابك على ${CONTACT_EMAIL} بعنوان «طلب حذف حساب» واذكر اسم المتجر. نرد خلال يوم عمل، وننفّذ الحذف خلال 7 أيام من التحقق من أن الطلب من صاحب الحساب.`,
        },
        {
          heading: 'ما الذي يُحذف',
          items: [
            'حسابك: الاسم والبريد الإلكتروني وكلمة المرور وربط الدخول بـ Google أو GitHub وجلسات الدخول.',
            'إن كنت المالك الوحيد للمتجر تُحذف بيانات المتجر كلها: الأعضاء (أرقام الجوال والأسماء والبريد والموافقات التسويقية)، وأرصدة النقاط والأختام وسجلها، والبرامج وتصميم البطاقات وصور الأختام، والحملات، وبطاقات الهدايا وسجلها، وحسابات الموظفين، وشعار المتجر، وتسجيلات بطاقات المحفظة، وروابط نقاط البيع، وسجل النشاط.',
            'إن كنت موظفاً يُحذف حسابك فقط ويبقى المتجر، وتبقى العمليات التي سجلتها في سجله دون اسمك.',
          ],
        },
        {
          heading: 'ما الذي نحتفظ به ولماذا',
          items: [
            'فواتير الاشتراك وسجلات الدفع (المبلغ والتاريخ ورقم الفاتورة والدفعة) ست سنوات بعد نهاية سنة الدفع، كما يلزم نظام ضريبة القيمة المضافة في المملكة، ثم تُحذف. لا تحتوي على بيانات عملاء المتجر.',
            'بطاقات الولاء والهدايا التي أضافها العملاء إلى محافظ جوالاتهم تتوقف عن التحديث. في Google Wallet نعطّلها ونزيل منها اسم العميل؛ والبطاقة في Apple Wallet نسخة على جهاز العميل يحذفها بنفسه.',
          ],
        },
        {
          heading: 'المدة',
          items: [
            'الحذف من التطبيق أو الموقع فوري. إن تعذّر إكماله لخلل تقني أعاد النظام المحاولة تلقائياً كل ساعة، ويكتمل خلال 24 ساعة.',
            'تُستبدل النسخ الاحتياطية المشفرة لدى مزوّد الاستضافة خلال 7 أيام.',
            'طلبات البريد الإلكتروني: خلال 7 أيام من التحقق.',
          ],
        },
        {
          heading: 'لعملاء المتاجر (أعضاء برامج الولاء)',
          body: `اطلب من المتجر حذف بياناتك، فهو يستطيع ذلك من صفحتك لديه، أو راسلنا على ${CONTACT_EMAIL} ونوصل طلبك إلى المتجر. يُحذف رقم جوالك واسمك وبريدك وموافقتك التسويقية، وتتوقف بطاقتك، ويسقط رصيدك المتبقي.`,
        },
      ],
    },
    en: {
      title: 'Delete your account',
      app: 'Mirqam Points',
      developer: 'Developer: Mirqam',
      intro:
        'This page explains how to delete your account in the Mirqam Points app (مرقام نقاط) and website, developed by Mirqam (مرقام), what is deleted, and what we keep and why.',
      sections: [
        {
          heading: 'In the app',
          steps: [
            'Open the Mirqam Points app and sign in.',
            `Open the menu and choose “${en.nav.settings}” (Arabic: «${ar.nav.settings}»).`,
            `On the “${en.settings.deleteTitle}” card (Arabic: «${ar.settings.deleteTitle}»), tap “${en.settings.deleteButton}” («${ar.settings.deleteButton}»).`,
            `Enter your password and tap “${en.settings.deleteForever}” («${ar.settings.deleteForever}»). If you sign in with Google or GitHub, sign in again when asked, then confirm.`,
          ],
        },
        {
          heading: 'On the website',
          steps: [
            `Sign in at ${SITE}.`,
            `Follow the same path: ${en.nav.settings} → ${en.settings.deleteTitle} → ${en.settings.deleteButton} → ${en.settings.deleteForever}.`,
          ],
        },
        {
          heading: 'By email',
          body: `If you cannot sign in, email ${CONTACT_EMAIL} from the address on your account, with the subject “Account deletion request” and your store’s name. We reply within one business day and complete the deletion within 7 days of confirming the request comes from the account holder.`,
        },
        {
          heading: 'What is deleted',
          items: [
            'Your account: name, email, password, linked Google or GitHub sign-in, and sessions.',
            'If you are the store’s only owner, all of the store’s data: members (phone numbers, names, emails, marketing consents), points and stamps balances and history, programs, card designs and stamp images, campaigns, gift cards and their history, staff accounts, the store logo, wallet-card registrations, point-of-sale links and the activity log.',
            'If you are staff, only your account is deleted. The store stays, and transactions you recorded stay in its records without your name.',
          ],
        },
        {
          heading: 'What we keep, and why',
          items: [
            'Subscription invoices and payment records (amount, date, invoice and payment reference), for six years after the end of the year of payment, as Saudi VAT rules require; then they are deleted. They contain no data about the store’s customers.',
            'Loyalty and gift cards that customers added to their phone wallets stop updating. In Google Wallet we deactivate them and remove the customer’s name; a card in Apple Wallet is a copy on the customer’s device that they can remove themselves.',
          ],
        },
        {
          heading: 'Timeline',
          items: [
            'Deletion in the app or on the website is immediate. If a technical fault interrupts it, the system retries automatically every hour and completes it within 24 hours.',
            'Encrypted backups at our hosting provider are overwritten within 7 days.',
            'Email requests: within 7 days of verification.',
          ],
        },
        {
          heading: 'Store customers (loyalty members)',
          body: `Ask the store to delete your data — it can do so from your member page — or email ${CONTACT_EMAIL} and we will pass your request to the store. Your phone number, name, email and marketing consent are deleted, your card stops working, and any remaining balance is forfeited.`,
        },
      ],
    },
  },
}
