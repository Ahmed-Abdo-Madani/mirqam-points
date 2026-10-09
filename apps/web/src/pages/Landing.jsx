import { MqBot, MqCheck, MqCoins, MqGift, MqPass, MqScan, MqShieldCheck, Pattern } from '@mirqam/ui'
import { Link } from 'react-router-dom'
import PassPreview from '../components/PassPreview.jsx'
import PublicShell from '../components/PublicShell.jsx'
import { useI18n } from '../i18n/index.jsx'

export default function Landing() {
  const { t } = useI18n()
  const features = [
    { icon: MqPass, key: 'passes' },
    { icon: MqCoins, key: 'programs' },
    { icon: MqScan, key: 'cashier' },
    { icon: MqGift, key: 'giftCards' },
    { icon: MqBot, key: 'whatsapp' },
    { icon: MqShieldCheck, key: 'trust' },
  ]
  return (
    <PublicShell>
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-[1240px] items-center gap-14 px-6 pb-20 pt-16 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-semibold text-accent">
              <i className="h-1.5 w-1.5 rotate-45 bg-brand-500" aria-hidden="true" />
              {t('landing.eyebrow')}
            </span>
            <h1 className="mt-6 text-[clamp(36px,4.6vw,62px)] font-bold leading-[1.35] tracking-[-1.5px]">
              {t('landing.title')} <span className="text-accent">{t('landing.titleAccent')}</span>
            </h1>
            <p className="mt-6 max-w-[520px] text-[17px] leading-loose text-muted">{t('landing.subtitle')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/register"
                className="inline-flex min-h-12 items-center rounded-[15px] bg-primary px-6 font-bold text-on-primary shadow-card hover:bg-primary-hover"
              >
                {t('auth.startFree')}
              </Link>
              <Link to="/login" className="inline-flex min-h-12 items-center rounded-[15px] border border-line bg-surface px-6 font-bold hover:bg-soft">
                {t('auth.login')}
              </Link>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
              {['proof1', 'proof2', 'proof3'].map((k) => (
                <li key={k} className="flex items-center gap-1.5">
                  <MqCheck className="h-4 w-4 text-accent" />
                  {t(`landing.${k}`)}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative flex justify-center lg:justify-end">
            <div className="pointer-events-none absolute -inset-10 text-brand-500" aria-hidden="true">
              <Pattern variant="diamonds" opacity={0.09} />
            </div>
            <div className="relative grid w-full max-w-[380px] gap-5">
              <PassPreview
                className="mp-float"
                merchant={t('landing.demoMerchant')}
                programName={t('landing.demoProgram')}
                type="stamps"
                balance={7}
                stampsRequired={10}
                memberName={t('landing.demoMember')}
                labels={{ balance: t('pass.stamps'), member: t('pass.member') }}
              />
              <div className="mq-card ms-auto flex w-fit items-center gap-3 px-4 py-3 text-sm font-semibold">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-tint text-accent">
                  <MqCoins className="h-5 w-5" />
                </span>
                <span>
                  {t('landing.toastTitle')}
                  <small className="block text-xs font-normal text-muted">{t('landing.toastBody')}</small>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-6 py-12" aria-labelledby="features-title">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <p className="text-xs font-bold text-accent">{t('landing.featuresKicker')}</p>
          <h2 id="features-title" className="mt-3 text-[clamp(28px,3.2vw,42px)] font-bold leading-snug tracking-[-0.8px]">
            {t('landing.featuresTitle')}
          </h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, key }) => (
            <article key={key} className="mq-card p-7 transition hover:-translate-y-1">
              <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-tint text-accent">
                <Icon className="h-[22px] w-[22px]" />
              </span>
              <h3 className="text-lg font-bold">{t(`landing.features.${key}.title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t(`landing.features.${key}.body`)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-6 pt-8">
        <div className="mp-welcome relative overflow-hidden rounded-[28px] px-8 py-12 text-white sm:px-14">
          <Pattern variant="diamonds" opacity={0.08} className="text-brand-300" />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-xl">
              <h2 className="text-[clamp(24px,3vw,36px)] font-bold leading-snug">{t('landing.ctaTitle')}</h2>
              <p className="mt-3 text-sm leading-loose text-navy-200">{t('landing.ctaBody')}</p>
            </div>
            <Link to="/register" className="inline-flex min-h-12 items-center rounded-[15px] bg-white px-6 font-bold text-navy-900 hover:bg-brand-50">
              {t('auth.startFree')}
            </Link>
          </div>
        </div>
      </section>
    </PublicShell>
  )
}
