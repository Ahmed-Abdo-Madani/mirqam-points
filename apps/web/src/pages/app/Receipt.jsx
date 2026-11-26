/* Subscription payment receipt («إيصال دفع») as a chrome-less A4 page, outside the
   console shell: print, PDF (the same pages drawn by the browser), email, WhatsApp
   and copy-link. Everything shown comes from GET /billing/receipts/:id, computed on
   the server from the settled payment. Billing is website-only. */
import { Button, EmptyState, MqArrowLeft, MqArrowRight, MqCopy, MqDownload, MqFileText, MqMail, MqMessages, MqSearch, Skeleton, useToast } from '@mirqam/ui'
import { COMPANY } from '@mirqam-points/shared'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Bi, DocPage, DocumentShell } from '../../components/documents/DocumentShell.jsx'
import { PaymentStamp } from '../../components/documents/PaymentStamp.jsx'
import { translate, useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, NATIVE, publicOrigin, useApi } from '../../lib/api.js'
import { downloadPdf, printDocument } from '../../lib/doc-pdf.js'
import { money } from '../../lib/format.js'

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older browsers and non-secure contexts: a selected textarea and the copy command.
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}

function ReceiptDocument({ view, locale }) {
  const { t } = useI18n()
  const other = locale === 'ar' ? 'en' : 'ar'
  const bi = (key, vars) => <Bi main={t(key, vars)} sub={translate(other, key, vars)} />
  const r = (key) => `documents.receipt.${key}`
  const cycle = (l) => translate(l, `documents.cycle.${view.cycle}`)
  const amount = (minor) => <bdi className="num">{money(minor, locale)}</bdi>
  const paidOn = `${view.paidAtRiyadh.date} ${view.paidAtRiyadh.time}`
  const period = view.coverageEndsRiyadh
    ? t(r('itemPeriod'), { cycle: cycle(locale), date: view.coverageEndsRiyadh })
    : t(r('itemCycle'), { cycle: cycle(locale) })
  return (
    <DocPage>
      <div className="doc-head">
        <div className="doc-issuer">
          <img className="doc-logo" src="/brand/app-icon.svg" alt="" />
          <div>
            <div className="doc-issuer-name">
              {view.issuer.legalName[locale]} <span className="sub">{view.issuer.legalName[other]}</span>
            </div>
            <dl className="doc-ids">
              <div>
                <dt>{bi(r('cr'))}</dt>
                <dd className="num">{view.issuer.crNumber}</dd>
              </div>
            </dl>
            <p className="doc-issuer-sub">{view.issuer.address[locale]}</p>
            <p className="doc-issuer-sub sub" dir={other === 'ar' ? 'rtl' : 'ltr'} lang={other}>
              {view.issuer.address[other]}
            </p>
            <p className="doc-contact">
              <bdi className="num">{view.issuer.email}</bdi>
            </p>
          </div>
        </div>
        <div className="doc-title">
          <h1>{t(r('title'))}</h1>
          <span className="sub">{translate(other, r('title'))}</span>
        </div>
      </div>

      <dl className="doc-meta">
        <div>
          <dt>{bi(r('number'))}</dt>
          <dd className="num">{view.number}</dd>
        </div>
        <div>
          <dt>{bi(r('paidOn'))}</dt>
          <dd className="num">{paidOn}</dd>
        </div>
        <div>
          <dt>{bi(r('cycle'))}</dt>
          <dd>
            <Bi main={cycle(locale)} sub={cycle(other)} />
          </dd>
        </div>
        {view.coverageEndsRiyadh && (
          <div>
            <dt>{bi(r('validUntil'))}</dt>
            <dd className="num">{view.coverageEndsRiyadh}</dd>
          </div>
        )}
      </dl>

      <div className="doc-parties">
        <div className="doc-party">
          <h2>{bi(r('receivedFrom'))}</h2>
          <strong>{view.party.name}</strong>
          {view.party.email && (
            <p>
              <bdi className="num">{view.party.email}</bdi>
            </p>
          )}
        </div>
        <div className="doc-party">
          <h2>{bi(r('payment'))}</h2>
          <dl className="doc-kv">
            <dt>{t(r('method'))}</dt>
            <dd>{t(r('methodOnline'))}</dd>
            {(view.reference.paymentId || view.reference.invoiceId) && (
              <>
                <dt>{t(r('reference'))}</dt>
                <dd className="num">{view.reference.paymentId || view.reference.invoiceId}</dd>
              </>
            )}
            {view.couponCode && (
              <>
                <dt>{t(r('coupon'))}</dt>
                <dd className="num">{view.couponCode}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      <table className="doc-lines">
        <thead>
          <tr>
            <th className="c-idx">{t(r('index'))}</th>
            <th>{bi(r('description'))}</th>
            <th className="c-num">{bi(r('qty'))}</th>
            <th className="c-num">{bi(r('amount'))}</th>
          </tr>
        </thead>
        <tbody>
          {view.lines.map((line, i) => (
            <tr key={`${line.item}-${i}`}>
              <td className="c-idx num">{i + 1}</td>
              <td>
                {t(r('item'))}
                <small>{period}</small>
              </td>
              <td className="c-num num">{line.quantity}</td>
              <td className="c-num">{amount(line.amountMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="doc-summary">
        <div className="doc-words">
          <h3>{bi(r('words'))}</h3>
          <p dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}>
            {view.amountWords[locale]}
          </p>
          <p className="sub" dir={other === 'ar' ? 'rtl' : 'ltr'} lang={other}>
            {view.amountWords[other]}
          </p>
        </div>
        <table className="doc-totals">
          <tbody>
            <tr>
              <th>{bi(r('subtotal'))}</th>
              <td>{amount(view.subtotalMinor)}</td>
            </tr>
            {view.discountMinor > 0 && (
              <tr>
                <th>{bi(r('discount'))}</th>
                <td>
                  <bdi className="num">−{money(view.discountMinor, locale)}</bdi>
                </td>
              </tr>
            )}
            <tr className="grand">
              <th>{bi(r('total'))}</th>
              <td>{amount(view.totalMinor)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <PaymentStamp
        kind={view.stamp?.kind}
        main={t(`documents.stamp.${view.stamp?.kind}`)}
        sub={translate(other, `documents.stamp.${view.stamp?.kind}`)}
        detail={view.paidAtRiyadh.date}
      />

      <div className="doc-notes">
        <ul>
          <li>{t(r('vatNote'))}</li>
          <li>{t(r('notTaxInvoice'))}</li>
          <li>{t(r('timeNote'))}</li>
        </ul>
      </div>
      <div className="doc-spacer" />
      <div className="doc-foot">
        <span>
          {COMPANY.legalName[locale]} · {t(r('cr'))} <bdi className="num">{COMPANY.crNumber}</bdi> · <bdi className="num">{view.number}</bdi>
        </span>
        <span>{t('documents.page', { n: 1, total: 1 })}</span>
      </div>
    </DocPage>
  )
}

export default function Receipt() {
  const { id } = useParams()
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const toast = useToast()
  const { data: view, loading, error, reload } = useApi(`/billing/receipts/${encodeURIComponent(id)}`)
  const [busy, setBusy] = useState(null)
  const [notice, setNotice] = useState(null)
  const Back = locale === 'ar' ? MqArrowRight : MqArrowLeft
  const link = `${publicOrigin()}/app/billing/receipts/${encodeURIComponent(id)}`

  async function savePdf() {
    setBusy('pdf')
    setNotice(null)
    try {
      await downloadPdf({ filename: `${view.number}.pdf`, title: `${t('documents.receipt.title')} ${view.number}` })
    } catch {
      // The browser could not draw the page: its own print dialog saves the same A4 page as PDF.
      setNotice({ tone: 'info', text: t('documents.pdfFallback') })
      await printDocument()
    } finally {
      setBusy(null)
    }
  }

  async function email() {
    setBusy('email')
    setNotice(null)
    try {
      const r = await api(`/billing/receipts/${encodeURIComponent(id)}/email`, { method: 'POST', body: { locale } })
      toast(t('documents.emailSent', { email: r.to }))
    } catch (err) {
      setNotice({ tone: 'err', text: errorText(err) })
    } finally {
      setBusy(null)
    }
  }

  async function copyLink() {
    const ok = await copyText(link)
    toast(t(ok ? 'documents.copied' : 'documents.copyFailed'), ok ? 'ok' : 'err')
  }

  const back = (
    <Link to="/app/billing" className="me-auto inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-accent">
      <Back className="h-4 w-4" />
      {t('documents.back')}
    </Link>
  )

  if (loading)
    return (
      <DocumentShell locale={locale} toolbar={back}>
        <Skeleton label={t('documents.loading')} rows={3} className="mx-auto max-w-[210mm] px-4" />
      </DocumentShell>
    )
  if (error || !view)
    return (
      <DocumentShell locale={locale} toolbar={back}>
        <div className="mx-auto max-w-[210mm] px-4">
          <div className="mq-card">
            {error?.code === 'receipt_not_found' ? (
              <EmptyState icon={MqSearch} title={t('documents.notFound')} desc={t('documents.notFoundBody')} />
            ) : (
              <EmptyState
                icon={MqFileText}
                title={t('documents.failed')}
                desc={errorText(error)}
                action={
                  <Button variant="outline" size="sm" onClick={reload}>
                    {t('documents.retry')}
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </DocumentShell>
    )

  const share = `https://wa.me/?text=${encodeURIComponent(`${t('documents.receipt.shareText', { number: view.number })}\n${link}`)}`
  const toolbar = (
    <>
      {back}
      {!NATIVE && (
        <>
          <Button size="sm" onClick={savePdf} loading={busy === 'pdf'} disabled={Boolean(busy)}>
            <MqDownload className="h-4 w-4" />
            {t(busy === 'pdf' ? 'documents.pdfBusy' : 'documents.pdf')}
          </Button>
          <Button variant="outline" size="sm" onClick={printDocument} disabled={Boolean(busy)}>
            <MqFileText className="h-4 w-4" />
            {t('documents.print')}
          </Button>
        </>
      )}
      <Button variant="outline" size="sm" onClick={email} loading={busy === 'email'} disabled={Boolean(busy)}>
        <MqMail className="h-4 w-4" />
        {t('documents.email')}
      </Button>
      {!NATIVE && (
        <>
          <a
            href={share}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-xs font-semibold text-ink transition hover:border-brand-500 hover:text-accent"
          >
            <MqMessages className="h-4 w-4" />
            {t('documents.whatsapp')}
          </a>
          <Button variant="outline" size="sm" onClick={copyLink}>
            <MqCopy className="h-4 w-4" />
            {t('documents.copyLink')}
          </Button>
        </>
      )}
    </>
  )
  return (
    <DocumentShell
      locale={locale}
      status={view.status}
      toolbar={toolbar}
      notice={
        notice && (
          <p
            role={notice.tone === 'err' ? 'alert' : 'status'}
            className={`rounded-xl border px-4 py-3 text-sm ${notice.tone === 'err' ? 'border-err/20 bg-err-bg text-err' : 'border-line bg-soft text-ink'}`}
          >
            {notice.text}
          </p>
        )
      }
    >
      <ReceiptDocument view={view} locale={locale} />
    </DocumentShell>
  )
}
