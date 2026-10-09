/* Legal & support copy (data, rendered by Legal.jsx). Keep both languages in
   step. Describes what the product actually stores — update it whenever the
   schema gains personal data. Have counsel review before wide launch. */

const company = {
  ar: 'شركة مرقام التجارية، السجل التجاري 7055011105، مبنى 8145، شارع المصيف 54، حي المصيف، حفر الباطن 39913، المملكة العربية السعودية',
  en: 'Mirqam Company Commercial, CR No. 7055011105, Building 8145, Al Masif 54 St., Al Masif Dist., Hafar Al Batin 39913, Kingdom of Saudi Arabia',
}
export const CONTACT_EMAIL = 'contact.bot@mirqam.sa'

export default {
  privacy: {
    ar: {
      title: 'سياسة الخصوصية',
      updated: 'آخر تحديث: 9 أكتوبر 2026',
      sections: [
        [
          'من نحن',
          `مرقام نقاط منصة برامج ولاء وبطاقات هدايا تشغّلها ${company.ar}. نعمل «معالجاً» لبيانات عملاء المتاجر التي تستخدم المنصة، والمتجر هو «المتحكم» في تلك البيانات وفق نظام حماية البيانات الشخصية.`,
        ],
        [
          'البيانات التي نجمعها',
          'لحسابات أصحاب المتاجر وموظفيهم: الاسم والبريد الإلكتروني وكلمة المرور (مخزّنة بشكل مُشفّر لا يمكن استرجاعه). لأعضاء برامج الولاء: رقم الجوال، والاسم والبريد إن قدّمهما العضو، وموافقة التسويق ووقتها، وسجل النقاط والأختام. لبطاقات الهدايا: القيمة والرصيد وسجل الاستخدام واسم المستلم ورقمه إن أُدخلا. عند إضافة البطاقة إلى Apple Wallet: معرّف الجهاز ورمز الإشعارات اللذان يرسلهما الجهاز لتحديث البطاقة. لا نجمع بيانات الموقع ولا جهات الاتصال.',
        ],
        [
          'كيف نستخدمها',
          'لتشغيل البرنامج فقط: احتساب النقاط واستبدالها، وإظهار البطاقة وتحديث رصيدها في محفظة الجوال، وحماية الحسابات من إساءة الاستخدام. لا نبيع البيانات ولا نستخدمها للإعلانات. لا تُرسل رسائل تسويقية إلا لمن وافق صراحةً.',
        ],
        [
          'المشاركة',
          'تُشارك البيانات اللازمة لعرض البطاقة مع Apple وGoogle عند إضافة العضو بطاقته إلى محفظته بنفسه، ومع مزوّد الاستضافة (Render) لتشغيل الخدمة. لا مشاركة أخرى إلا بأمر نظامي.',
        ],
        [
          'الاحتفاظ والحذف',
          'تُحفظ بيانات الحساب ما دام نشطاً. يمكن لصاحب الحساب حذفه من داخل التطبيق (الإعدادات ← حذف الحساب). يُحتفظ بسجل العمليات المالية للمتجر للمدة التي تتطلبها الأنظمة المحاسبية. يمكن لعضو البرنامج طلب الاطلاع على بياناته أو تصحيحها أو حذفها من المتجر أو بمراسلتنا.',
        ],
        ['الأمان', 'الاتصال مشفّر (HTTPS)، وكلمات المرور مُجزّأة، ورموز بطاقات الهدايا مشفّرة أثناء التخزين، وسجل النقاط غير قابل للتعديل.'],
        ['التواصل', `لأي سؤال أو طلب يتعلق بالخصوصية: ${CONTACT_EMAIL}`],
      ],
    },
    en: {
      title: 'Privacy Policy',
      updated: 'Last updated: 9 October 2026',
      sections: [
        [
          'Who we are',
          `Mirqam Points is a loyalty and gift-card platform operated by ${company.en}. We act as a processor of the personal data of the stores' customers; each store is the controller of that data under the Saudi Personal Data Protection Law (PDPL).`,
        ],
        [
          'What we collect',
          'For store owners and staff: name, email and password (stored as a one-way hash). For loyalty members: mobile number, name and email if provided, marketing consent and its time, and points/stamps history. For gift cards: value, balance, usage history and, if entered, the recipient’s name and number. When a card is added to Apple Wallet: the device identifier and push token the device sends so the card can update. We do not collect location or contacts.',
        ],
        [
          'How we use it',
          'Only to run the program: earning and redeeming, showing the card and keeping its balance current in the phone wallet, and protecting accounts from abuse. We do not sell data or use it for advertising. Marketing messages are sent only to members who explicitly opted in.',
        ],
        [
          'Sharing',
          'Data needed to display a card is shared with Apple or Google when the member chooses to add the card to their wallet, and with our hosting provider (Render) to run the service. Nothing else, unless required by law.',
        ],
        [
          'Retention and deletion',
          'Account data is kept while the account is active. Account holders can delete their account in the app (Settings → Delete account). A store’s transaction records are kept as long as accounting regulations require. Members can ask the store, or us, to access, correct or delete their data.',
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
        ['لأصحاب المتاجر', 'أنشئ حساباً، ثم برنامجاً، وفعّله، وابدأ من شاشة الكاشير. حذف الحساب متاح في الإعدادات.'],
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
        ['Store owners', 'Create an account, create and activate a program, and start from the cashier screen. Account deletion is in Settings.'],
      ],
    },
  },
}
