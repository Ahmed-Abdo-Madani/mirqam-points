/* Subscription emails, Arabic first. Pure functions: same input, same output. */
const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const PLAN = { ar: { monthly: 'الاشتراك الشهري', yearly: 'الاشتراك السنوي' }, en: { monthly: 'Monthly plan', yearly: 'Yearly plan' } }

export const formatDate = (iso, locale) =>
  new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn-ca-gregory', { dateStyle: 'long', timeZone: 'Asia/Riyadh' }).format(new Date(iso))

const sar = (minor, locale) => `${(minor / 100).toFixed(2)} ${locale === 'en' ? 'SAR' : 'ر.س'}`

/* kind → { subject, lines[], cta } per locale. `d` carries cycle, amountMinor, expiresAt, days. */
function copy(kind, locale, d, tenantName) {
  const plan = PLAN[locale][d.cycle] || ''
  const until = d.expiresAt ? formatDate(d.expiresAt, locale) : ''
  if (locale === 'en') {
    switch (kind) {
      case 'activated':
        return {
          subject: `Your ${tenantName} subscription is active`,
          lines: [`Thank you! Your payment of ${sar(d.amountMinor, 'en')} was received and your ${plan} is now active.`, `Valid until ${until}.`],
          cta: 'Open billing',
        }
      case 'renewed':
        return {
          subject: `Subscription renewed for ${tenantName}`,
          lines: [`Your ${plan} was renewed with a payment of ${sar(d.amountMinor, 'en')}.`, `Valid until ${until}.`],
          cta: 'Open billing',
        }
      case 'plan_changed':
        return {
          subject: `Your plan changed to ${plan}`,
          lines: [`Your payment of ${sar(d.amountMinor, 'en')} was received and your subscription is now the ${plan}.`, `Valid until ${until}.`],
          cta: 'Open billing',
        }
      case 'payment_failed':
        return {
          subject: `Payment failed for ${tenantName}`,
          lines: [
            `We could not process your ${sar(d.amountMinor, 'en')} payment for the ${plan}. Your subscription has not changed.`,
            'You can try again with another card from the billing page.',
          ],
          cta: 'Try again',
        }
      case 'expiring_soon':
        return {
          subject: d.days <= 1 ? `Your subscription ends tomorrow — ${tenantName}` : `Your subscription ends in ${d.days} days — ${tenantName}`,
          lines: [`Your ${plan} ends on ${until}.`, 'Renew now to keep recording purchases and sending campaigns without interruption.'],
          cta: 'Renew now',
        }
      default:
        return {
          subject: `Your subscription has expired — ${tenantName}`,
          lines: [`Your ${plan} ended on ${until}.`, 'Your data is safe. Renew to continue recording purchases and redemptions.'],
          cta: 'Renew subscription',
        }
    }
  }
  switch (kind) {
    case 'activated':
      return {
        subject: `تم تفعيل اشتراك ${tenantName}`,
        lines: [`شكراً لك! استلمنا دفعتك بقيمة ${sar(d.amountMinor, 'ar')} وأصبح ${plan} فعّالاً.`, `صالح حتى ${until}.`],
        cta: 'فتح صفحة الاشتراك',
      }
    case 'renewed':
      return {
        subject: `تم تجديد اشتراك ${tenantName}`,
        lines: [`تم تجديد ${plan} بدفعة قيمتها ${sar(d.amountMinor, 'ar')}.`, `صالح حتى ${until}.`],
        cta: 'فتح صفحة الاشتراك',
      }
    case 'plan_changed':
      return {
        subject: `تم تغيير خطتك إلى ${plan}`,
        lines: [`استلمنا دفعتك بقيمة ${sar(d.amountMinor, 'ar')} وأصبح اشتراكك الآن ${plan}.`, `صالح حتى ${until}.`],
        cta: 'فتح صفحة الاشتراك',
      }
    case 'payment_failed':
      return {
        subject: `تعذّرت عملية الدفع — ${tenantName}`,
        lines: [
          `لم نتمكن من إتمام دفعتك بقيمة ${sar(d.amountMinor, 'ar')} لـ ${plan}. لم يتغير اشتراكك.`,
          'يمكنك المحاولة مرة أخرى ببطاقة أخرى من صفحة الاشتراك.',
        ],
        cta: 'إعادة المحاولة',
      }
    case 'expiring_soon':
      return {
        subject: d.days <= 1 ? `ينتهي اشتراكك غداً — ${tenantName}` : `ينتهي اشتراكك خلال ${d.days} أيام — ${tenantName}`,
        lines: [`ينتهي ${plan} في ${until}.`, 'جدّد الآن لمواصلة تسجيل العمليات وإرسال الحملات دون انقطاع.'],
        cta: 'جدّد الآن',
      }
    default:
      return {
        subject: `انتهى اشتراكك — ${tenantName}`,
        lines: [`انتهى ${plan} في ${until}.`, 'بياناتك محفوظة. جدّد اشتراكك لمواصلة تسجيل عمليات الشراء والاستبدال.'],
        cta: 'تجديد الاشتراك',
      }
  }
}

export function renderSubscriptionEmail(kind, { locale = 'ar', tenantName, data = {}, url }) {
  const l = locale === 'en' ? 'en' : 'ar'
  const { subject, lines, cta } = copy(kind, l, data, tenantName)
  const dir = l === 'ar' ? 'rtl' : 'ltr'
  const html = [
    `<div dir="${dir}" style="font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;max-width:520px;margin:auto;color:#0e1726;line-height:1.8">`,
    `<h2 style="color:#172740;margin:0 0 12px">${esc(subject)}</h2>`,
    ...lines.map((x) => `<p style="margin:0 0 10px">${esc(x)}</p>`),
    `<p style="margin:20px 0"><a href="${esc(url)}" style="background:#172740;color:#fff;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:700">${esc(cta)}</a></p>`,
    `<p style="color:#69788a;font-size:12px;margin:24px 0 0">${l === 'ar' ? 'مرقام نقاط — برامج الولاء وبطاقات الهدايا' : 'Mirqam Points — loyalty programs and gift cards'}</p>`,
    '</div>',
  ].join('')
  return { subject, html }
}
