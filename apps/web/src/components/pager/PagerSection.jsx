import { MqCheck, MqImage, MqLink, MqListChecks, MqLock, MqMessages, MqMonitor, MqTrendUp, Pattern } from '@mirqam/ui'
import { PAGER_PLANS, PAGER_TRIAL_DAYS } from '@mirqam-points/shared'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../../i18n/index.jsx'
import { CycleSwitch, PagerFinePrint, PagerPlanCards, price } from '../PagerPlans.jsx'
import Qr from '../Qr.jsx'
import { PAGER_CHECKOUT_ENABLED, PAGER_LIVE_CARD_RELEASED, PAGER_SHOW_PRICES, PAGER_TRIAL_PATH, pagerWhatsappLink } from './flags.js'

/* «بيجر مرقام» section of the landing page (#pager): intro with an illustrative waiting page,
   three steps, features, plans and FAQ. Copy: i18n `landing.pager.*`; prices: the plan catalog. */

const FEATURE_ICONS = [MqListChecks, MqMonitor, MqMessages, MqTrendUp, MqImage, MqLink]
const PLUS_FEATURE = 2

const primaryBtn =
  'inline-flex min-h-12 items-center justify-center rounded-[15px] bg-primary px-6 font-bold text-on-primary shadow-card hover:bg-primary-hover'
const secondaryBtn = 'inline-flex min-h-12 items-center justify-center rounded-[15px] border border-line bg-surface px-6 font-bold hover:bg-soft'

/** The section's buttons: trial when online purchase is on, otherwise WhatsApp. */
function PagerActions({ center = false }) {
  const { t } = useI18n()
  const wa = pagerWhatsappLink(t('landing.pager.cta.whatsappText'))
  return (
    <div className={center ? 'text-center' : ''}>
      <div className={`flex flex-wrap gap-3 ${center ? 'justify-center' : ''}`}>
        {PAGER_CHECKOUT_ENABLED ? (
          <>
            <Link to={PAGER_TRIAL_PATH} className={primaryBtn} data-cta="pager_cta_trial">
              {t('landing.pager.cta.trial')}
            </Link>
            <a href="#pager-plans" className={secondaryBtn}>
              {t('landing.pager.cta.plans')}
            </a>
          </>
        ) : (
          <>
            <a href={wa} target="_blank" rel="noopener noreferrer" className={primaryBtn} data-cta="pager_cta_demo">
              {t('landing.pager.cta.demo')}
            </a>
            <a href={wa} target="_blank" rel="noopener noreferrer" className={secondaryBtn} data-cta="pager_cta_whatsapp">
              {t('landing.pager.cta.whatsapp')}
            </a>
          </>
        )}
      </div>
      {!PAGER_CHECKOUT_ENABLED && <p className="mt-3 text-xs text-muted">{t('landing.pager.cta.contactNote')}</p>}
    </div>
  )
}

/** Illustrative waiting page + receipt QR. No real data, labelled as a preview. */
function PagerPreview() {
  const { t } = useI18n()
  return (
    <figure className="relative m-0 flex justify-center lg:justify-end" aria-label={t('landing.pager.demoLabel')}>
      <div className="pointer-events-none absolute -inset-8 text-brand-500" aria-hidden="true">
        <Pattern variant="diamonds" opacity={0.07} />
      </div>
      <div className="relative w-full max-w-[290px] rounded-[34px] border border-line bg-surface p-3 shadow-card">
        <div className="rounded-[26px] bg-soft px-5 pb-6 pt-5 text-center">
          <p className="text-xs font-semibold text-muted">{t('landing.pager.preview.brand')}</p>
          <p className="mt-5 text-xs text-muted">{t('landing.pager.preview.order')}</p>
          <p className="tnum text-[54px] font-bold leading-tight">42</p>
          <span className="mt-1 inline-flex rounded-full bg-tint px-3 py-1 text-xs font-bold text-accent">{t('landing.pager.preview.status')}</span>
          <div className="mx-auto mt-5 h-1.5 w-40 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <i className="block h-full w-2/3 rounded-full bg-accent" />
          </div>
          <p className="mt-5 text-xs leading-relaxed text-muted">{t('landing.pager.preview.ready')}</p>
        </div>
      </div>
      <div className="mq-card absolute -bottom-6 start-0 flex items-center gap-3 px-3 py-2.5 text-xs font-semibold lg:start-auto lg:end-[250px]">
        <Qr value="https://p.mirqam.sa/" size={56} label={t('landing.pager.preview.receipt')} className="!p-1" />
        <span className="max-w-[110px]">{t('landing.pager.preview.receipt')}</span>
      </div>
      <figcaption className="absolute -top-3 end-2 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-muted">
        {t('landing.pager.demoLabel')}
      </figcaption>
    </figure>
  )
}

export default function PagerSection() {
  const { t, locale } = useI18n()
  const [cycle, setCycle] = useState('monthly')
  const chips = [0, 1, 2]
  const faq = [0, 1, 2, 3]
  const p = (minor) => price(minor, locale)
  const priceAnswer = PAGER_SHOW_PRICES
    ? t('landing.pager.faq.items.4.a', {
        basic: p(PAGER_PLANS.basic.prices.monthly),
        plus: p(PAGER_PLANS.plus.prices.monthly),
        basicLoyalty: p(PAGER_PLANS.basic.withLoyalty.monthly),
        plusLoyalty: p(PAGER_PLANS.plus.withLoyalty.monthly),
      }) + (PAGER_CHECKOUT_ENABLED ? t('landing.pager.faq.trial', { days: PAGER_TRIAL_DAYS }) : '')
    : t('landing.pager.faq.priceInApp.a')

  return (
    <section id="pager" className="scroll-mt-24 border-y border-line bg-surface/40" aria-labelledby="pager-title">
      <div className="mx-auto grid max-w-[1240px] items-center gap-14 px-6 py-16 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <p className="text-xs font-bold text-accent">{t('landing.pager.kicker')}</p>
          <h2 id="pager-title" className="mt-3 text-[clamp(30px,3.6vw,48px)] font-bold leading-snug tracking-[-1px]">
            {t('landing.pager.title')}
          </h2>
          <p className="mt-4 max-w-[540px] text-[16px] leading-loose text-muted">{t('landing.pager.subtitle')}</p>
          <ul className="mt-5 flex flex-wrap gap-2 text-xs font-semibold">
            {chips.map((i) => (
              <li key={i} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5">
                <MqCheck className="h-3.5 w-3.5 text-accent" />
                {t(`landing.pager.chips.${i}`)}
              </li>
            ))}
          </ul>
          <div className="mt-7">
            <PagerActions />
          </div>
        </div>
        <PagerPreview />
      </div>

      <div className="mx-auto max-w-[1240px] px-6 py-10">
        <h3 className="text-center text-[clamp(22px,2.4vw,30px)] font-bold">{t('landing.pager.steps.title')}</h3>
        <ol className="mt-8 grid gap-5 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="mq-card p-6">
              <span className="tnum flex h-9 w-9 items-center justify-center rounded-full bg-tint font-bold text-accent">{i + 1}</span>
              <h4 className="mt-4 text-base font-bold">{t(`landing.pager.steps.items.${i}.t`)}</h4>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t(`landing.pager.steps.items.${i}.d`)}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="mx-auto max-w-[1240px] px-6 py-10">
        <h3 className="text-center text-[clamp(22px,2.4vw,30px)] font-bold">{t('landing.pager.features.title')}</h3>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_ICONS.map((Icon, i) => (
            <article key={i} className="mq-card p-6">
              <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-tint text-accent">
                <Icon className="h-[22px] w-[22px]" />
              </span>
              <h4 className="text-base font-bold">
                {t(`landing.pager.features.items.${i}.t`)}
                {i === PLUS_FEATURE && (
                  <span className="ms-2 inline-flex rounded-full bg-primary px-2 py-0.5 align-middle text-[11px] font-bold text-on-primary">
                    {t('landing.pager.features.plus')}
                  </span>
                )}
              </h4>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t(`landing.pager.features.items.${i}.d`)}</p>
            </article>
          ))}
          {!PAGER_LIVE_CARD_RELEASED && (
            <article className="flex flex-col rounded-[var(--radius-card,20px)] border border-dashed border-line p-6 sm:col-span-2 lg:col-span-3 lg:flex-row lg:items-center lg:gap-6">
              <span className="mb-4 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-soft text-muted lg:mb-0">
                <MqLock className="h-[22px] w-[22px]" />
              </span>
              <div className="flex-1">
                <h4 className="text-base font-bold">
                  {t('landing.pager.liveCard.t')}
                  <span className="ms-2 inline-flex rounded-full bg-[#ffe7a6] px-2 py-0.5 align-middle text-[11px] font-bold text-[#5a4300]">
                    {t('landing.pager.soon')}
                  </span>
                </h4>
                <p className="mt-1 text-sm leading-relaxed text-muted">{t('landing.pager.liveCard.d')}</p>
              </div>
            </article>
          )}
        </div>
      </div>

      <div id="pager-plans" className="mx-auto max-w-[1040px] scroll-mt-24 px-6 py-10">
        <div className="mx-auto mb-8 max-w-2xl text-center">
          <h3 className="text-[clamp(22px,2.4vw,30px)] font-bold">{t('landing.pager.plans.title')}</h3>
          <p className="mt-3 text-sm leading-loose text-muted">{t(PAGER_SHOW_PRICES ? 'landing.pager.plans.subtitle' : 'landing.pager.plans.inApp')}</p>
          {PAGER_SHOW_PRICES && (
            <div className="mt-6">
              <CycleSwitch cycle={cycle} onChange={setCycle} />
            </div>
          )}
        </div>
        <PagerPlanCards cycle={cycle} showPrices={PAGER_SHOW_PRICES} />
        {PAGER_SHOW_PRICES && <PagerFinePrint />}
        <div className="mt-8">
          <PagerActions center />
        </div>
      </div>

      <div className="mx-auto max-w-[840px] px-6 pb-16 pt-6">
        <h3 className="text-center text-[clamp(22px,2.4vw,30px)] font-bold">{t('landing.pager.faq.title')}</h3>
        <div className="mt-6 grid gap-3">
          {faq.map((i) => (
            <details key={i} className="mq-card group px-5 py-4">
              <summary className="cursor-pointer list-none font-bold">{t(`landing.pager.faq.items.${i}.q`)}</summary>
              <p className="mt-3 text-sm leading-loose text-muted">{t(`landing.pager.faq.items.${i}.a`)}</p>
            </details>
          ))}
          <details className="mq-card group px-5 py-4">
            <summary className="cursor-pointer list-none font-bold">
              {t(PAGER_SHOW_PRICES && PAGER_CHECKOUT_ENABLED ? 'landing.pager.faq.items.4.q' : 'landing.pager.faq.priceInApp.q')}
            </summary>
            <p className="mt-3 text-sm leading-loose text-muted">{priceAnswer}</p>
          </details>
        </div>
      </div>
    </section>
  )
}
