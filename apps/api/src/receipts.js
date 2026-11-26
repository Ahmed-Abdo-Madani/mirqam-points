/* Subscription payment receipts («إيصال دفع»), legacy direct-Moyasar payments only.
   A receipt is derived from a subscription_checkouts row that settled (status 'paid'):
   there is no receipt table and nothing here writes. Amounts come from what was charged
   (the stored amount and quote), never from today's price list, and the «مدفوع» stamp
   exists only because the row is paid. It is not a tax invoice: Mirqam has no VAT
   number on record, so there is no VAT split. */
import { amountInArabicWords, amountInEnglishWords, COMPANY, formatMinor, SITE_NAME } from '@mirqam-points/shared'
import { int } from './db/index.js'
import { HttpError } from './http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RIYADH = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Riyadh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Calendar date and clock time of an instant in Asia/Riyadh: { date: 'YYYY-MM-DD', time: 'HH:mm' }. */
export function riyadhParts(value) {
  const p = Object.fromEntries(RIYADH.formatToParts(new Date(value)).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

/** Deterministic receipt number: ML-R-<Riyadh yyyymmdd of the payment>-<first 8 hex of the checkout id>. */
export function receiptNumber(row) {
  return `ML-R-${riyadhParts(row.paid_at).date.replaceAll('-', '')}-${String(row.id).slice(0, 8).toUpperCase()}`
}

/* What was charged. A coupon or referral checkout stored its validated quote (subtotal −
   discount = amount); anything else was charged its stored amount with no discount. */
export function receiptAmounts(row) {
  const total = int(row.amount)
  const q = row.commerce_quote
  const subtotal = q?.subtotalMinor
  const discount = q?.discountMinor
  if (Number.isSafeInteger(subtotal) && Number.isSafeInteger(discount) && discount >= 0 && subtotal - discount === total)
    return { subtotalMinor: subtotal, discountMinor: discount, totalMinor: total }
  return { subtotalMinor: total, discountMinor: 0, totalMinor: total }
}

const validDate = (value) => (value && !Number.isNaN(new Date(value).getTime()) ? new Date(value) : null)

/** The receipt view model for a checkout row, or null when the row is not a settled payment. */
export function receiptView({ checkout, tenantName, ownerEmail = null, coverageEndsAt = null }) {
  if (checkout?.status !== 'paid' || !validDate(checkout.paid_at)) return null
  const amounts = receiptAmounts(checkout)
  const paidAt = new Date(checkout.paid_at)
  const coverage = validDate(coverageEndsAt)
  return {
    id: checkout.id,
    number: receiptNumber(checkout),
    status: 'paid',
    stamp: { kind: 'paid' },
    cycle: checkout.cycle,
    currency: checkout.currency || 'SAR',
    paidAt: paidAt.toISOString(),
    paidAtRiyadh: riyadhParts(paidAt),
    coverageEndsAt: coverage ? coverage.toISOString() : null,
    coverageEndsRiyadh: coverage ? riyadhParts(coverage).date : null,
    couponCode: checkout.coupon_code || null,
    lines: [{ item: 'subscription', cycle: checkout.cycle, quantity: 1, amountMinor: amounts.subtotalMinor }],
    ...amounts,
    paidMinor: amounts.totalMinor,
    vatIncluded: true,
    amountWords: { ar: amountInArabicWords(amounts.totalMinor), en: amountInEnglishWords(amounts.totalMinor) },
    reference: { paymentId: checkout.payment_id || null, invoiceId: checkout.invoice_id || null },
    issuer: { legalName: COMPANY.legalName, crNumber: COMPANY.crNumber, address: COMPANY.address, email: COMPANY.email },
    party: { name: tenantName, email: ownerEmail },
  }
}

const COLUMNS = 'id, cycle, amount, currency, status, paid_at, payment_id, invoice_id, coupon_code, commerce_quote'

/** This tenant's settled payments, newest first. */
export async function listReceipts(db, tenantId, { limit = 25, offset = 0 } = {}) {
  const where = "tenant_id = $1 AND status = 'paid' AND paid_at IS NOT NULL"
  const [{ rows }, count] = await Promise.all([
    db.query(`SELECT id, cycle, amount, currency, paid_at FROM subscription_checkouts WHERE ${where} ORDER BY paid_at DESC, id DESC LIMIT $2 OFFSET $3`, [
      tenantId,
      limit,
      offset,
    ]),
    db.query(`SELECT count(*)::int AS n FROM subscription_checkouts WHERE ${where}`, [tenantId]),
  ])
  return {
    items: rows.map((r) => ({
      id: r.id,
      number: receiptNumber(r),
      paidAt: new Date(r.paid_at).toISOString(),
      cycle: r.cycle,
      amountMinor: int(r.amount),
      currency: r.currency,
      status: 'paid',
    })),
    total: int(count.rows[0].n),
  }
}

/** One receipt of this tenant; any other id (another tenant's, unpaid, malformed) is 404. */
export async function loadReceipt(db, tenantId, id) {
  if (!UUID.test(String(id))) throw new HttpError(404, 'receipt_not_found')
  const checkout = (await db.query(`SELECT ${COLUMNS} FROM subscription_checkouts WHERE tenant_id = $1 AND id = $2 AND status = 'paid'`, [tenantId, id]))
    .rows[0]
  if (!checkout) throw new HttpError(404, 'receipt_not_found')
  const [tenant, owner, event] = await Promise.all([
    db.query('SELECT name FROM tenants WHERE id = $1', [tenantId]),
    db.query(
      "SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1 AND m.role = 'owner' AND u.deleted_at IS NULL ORDER BY m.created_at LIMIT 1",
      [tenantId],
    ),
    // The period this payment bought ends where its activation/renewal event says.
    db.query(
      "SELECT data FROM subscription_events WHERE tenant_id = $1 AND ref = $2 AND kind IN ('activated', 'renewed', 'plan_changed') ORDER BY created_at LIMIT 1",
      [tenantId, checkout.id],
    ),
  ])
  const view = receiptView({
    checkout,
    tenantName: tenant.rows[0]?.name ?? '',
    ownerEmail: owner.rows[0]?.email ?? null,
    coverageEndsAt: event.rows[0]?.data?.expiresAt ?? null,
  })
  if (!view) throw new HttpError(404, 'receipt_not_found')
  return view
}

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const EMAIL = {
  ar: {
    subject: (n) => `إيصال دفع اشتراك ${SITE_NAME.ar} ${n}`,
    intro: (name) => `مرحبًا، هذا إيصال دفع اشتراك «${name}» في ${SITE_NAME.ar}.`,
    number: 'رقم الإيصال',
    amount: 'المبلغ المدفوع',
    paidOn: 'تاريخ الدفع',
    currency: (m) => `${formatMinor(m)} ر.س`,
    vat: 'الأسعار شاملة ضريبة القيمة المضافة.',
    cta: 'عرض الإيصال',
  },
  en: {
    subject: (n) => `${SITE_NAME.en} payment receipt ${n}`,
    intro: (name) => `Hello, here is the payment receipt for the ${SITE_NAME.en} subscription of “${name}”.`,
    number: 'Receipt number',
    amount: 'Amount paid',
    paidOn: 'Paid on',
    currency: (m) => `SAR ${formatMinor(m)}`,
    vat: 'Prices include VAT.',
    cta: 'View receipt',
  },
}

/** A short HTML email with the receipt's key facts and a link to it in the console. */
export function renderReceiptEmail(view, { locale = 'ar', url }) {
  const l = locale === 'en' ? 'en' : 'ar'
  const c = EMAIL[l]
  const row = (label, value) =>
    `<tr><td style="padding:4px 0;color:#556375">${esc(label)}</td><td style="padding:4px 12px;font-weight:700" dir="ltr">${esc(value)}</td></tr>`
  const html = [
    `<div dir="${l === 'ar' ? 'rtl' : 'ltr'}" style="font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;max-width:520px;margin:auto;color:#172740;line-height:1.8">`,
    `<h2 style="color:#0f6f74;margin:0 0 12px">${esc(c.subject(view.number))}</h2>`,
    `<p style="margin:0 0 10px">${esc(c.intro(view.party.name))}</p>`,
    '<table style="border-collapse:collapse;margin:0 0 10px">',
    row(c.number, view.number),
    row(c.amount, c.currency(view.totalMinor)),
    row(c.paidOn, `${view.paidAtRiyadh.date} ${view.paidAtRiyadh.time}`),
    '</table>',
    `<p style="margin:0 0 10px;color:#556375">${esc(c.vat)}</p>`,
    `<p style="margin:20px 0"><a href="${esc(url)}" style="background:#172740;color:#fff;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:700">${esc(c.cta)}</a></p>`,
    `<p style="color:#69788a;font-size:12px;margin:24px 0 0">${esc(COMPANY.legalName[l])} · ${l === 'ar' ? 'السجل التجاري' : 'CR No.'} ${COMPANY.crNumber}</p>`,
    '</div>',
  ].join('')
  return { subject: c.subject(view.number), html }
}
