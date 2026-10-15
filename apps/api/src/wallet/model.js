/* Platform-neutral pass model. Apple and Google renderers consume this, so a
   pass looks and reads the same in both wallets. */
import { DEFAULT_DESIGN, normalizeDesign } from '@mirqam-points/shared'
import { int } from '../db/index.js'

export { DEFAULT_DESIGN, normalizeDesign }

export const rgb = (hex) => `rgb(${Number.parseInt(hex.slice(1, 3), 16)}, ${Number.parseInt(hex.slice(3, 5), 16)}, ${Number.parseInt(hex.slice(5, 7), 16)})`

export const loyaltySerial = (accountId, version) => `acct-${accountId}-v${version}`
export const giftSerial = (cardId) => `gift-${cardId}`

export function parseSerial(serial) {
  let m = /^acct-([0-9a-f-]{36})-v(\d+)$/.exec(serial)
  if (m) return { kind: 'loyalty', id: m[1], version: Number(m[2]) }
  m = /^gift-([0-9a-f-]{36})$/.exec(serial)
  if (m) return { kind: 'gift', id: m[1] }
  return null
}

export const LOYALTY_SQL = `
  SELECT a.id, a.tenant_id, a.pass_token AS token, a.balance, a.lifetime_earned, a.code, a.pass_token, a.apple_auth, a.pass_version, a.updated_at,
         m.name AS member_name, m.locale, p.id AS program_id, p.name AS program_name, p.type, p.config, p.design,
         t.name AS merchant, t.slug, t.logo_version, msg.title AS msg_title, msg.body AS msg_body, msg.created_at AS msg_at
    FROM accounts a
    JOIN members m ON m.id = a.member_id
    JOIN programs p ON p.id = a.program_id
    JOIN tenants t ON t.id = a.tenant_id
    LEFT JOIN LATERAL (
      SELECT c.title, c.body, c.created_at FROM campaign_recipients cr JOIN campaigns c ON c.id = cr.campaign_id
       WHERE cr.account_id = a.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1
    ) msg ON true`

const logoUrl = (row, publicUrl) => (row.logo_version ? `${publicUrl}/api/public/logo/${row.slug}?v=${row.logo_version}` : null)

export function loyaltyModel(row, publicUrl) {
  return {
    kind: 'loyalty',
    id: row.id,
    serial: loyaltySerial(row.id, row.pass_version),
    version: row.pass_version,
    authToken: row.apple_auth,
    tenantId: row.tenant_id,
    merchant: row.merchant,
    logoVersion: row.logo_version,
    logoUrl: logoUrl(row, publicUrl),
    passToken: row.token,
    programId: row.program_id,
    programName: row.program_name,
    type: row.type,
    balance: int(row.balance),
    lifetime: int(row.lifetime_earned),
    stampsRequired: row.type === 'stamps' ? row.config?.stampsRequired : null,
    memberName: row.member_name || '',
    locale: row.locale || 'ar',
    barcode: `MP:${row.code}`,
    code: row.code,
    design: normalizeDesign(row.design),
    // The latest campaign this pass received; wallets surface it as a notification when it changes.
    message: row.msg_title ? { title: row.msg_title, body: row.msg_body, sentAt: new Date(row.msg_at) } : null,
    url: `${publicUrl}/p/${row.pass_token}`,
    updatedAt: new Date(row.updated_at),
  }
}

export const GIFT_SQL = `
  SELECT g.*, t.name AS merchant, t.slug, t.logo_version FROM gift_cards g JOIN tenants t ON t.id = g.tenant_id`

export function giftModel(row, code, publicUrl) {
  return {
    kind: 'gift',
    id: row.id,
    serial: giftSerial(row.id),
    authToken: row.apple_auth,
    tenantId: row.tenant_id,
    merchant: row.merchant,
    logoVersion: row.logo_version,
    logoUrl: logoUrl(row, publicUrl),
    balanceMinor: int(row.balance_minor),
    initialMinor: int(row.initial_minor),
    status: row.status,
    expiresAt: row.expires_at,
    recipientName: row.recipient_name || '',
    senderName: row.sender_name || '',
    message: row.message || '',
    // Scanners read the raw code; people read it grouped (XXXX-XXXX-XXXX-XXXX).
    barcode: code,
    code: code.match(/.{1,4}/g).join('-'),
    design: DEFAULT_DESIGN,
    url: `${publicUrl}/gift/${row.public_token}`,
    updatedAt: new Date(row.updated_at),
  }
}

/* Copy used on passes (passes are rendered server-side, in the member's language). */
export const PASS_TEXT = {
  ar: {
    points: 'النقاط',
    stamps: 'الأختام',
    member: 'العضو',
    program: 'البرنامج',
    balance: 'الرصيد',
    code: 'رقم البطاقة',
    from: 'من',
    message: 'الرسالة',
    expires: 'تنتهي',
    details: 'تفاصيل البطاقة',
    terms: 'الشروط',
    loyaltyTerms: 'تُستبدل النقاط لدى المتجر فقط ولا تُصرف نقداً.',
    giftTerms: 'بطاقة هدية لدى المتجر، لا تُستبدل نقداً.',
    balanceNow: 'رصيدك الآن %@',
    giftCard: 'بطاقة هدية',
    reward: 'المكافأة',
    open: 'فتح البطاقة',
    remaining: 'المتبقي',
    remainingStamps: 'ختم للمكافأة',
    lifetime: 'إجمالي المكتسب',
    info: 'معلومات',
    rewardReady: 'المكافأة جاهزة',
  },
  en: {
    points: 'Points',
    stamps: 'Stamps',
    member: 'Member',
    program: 'Program',
    balance: 'Balance',
    code: 'Card number',
    from: 'From',
    message: 'Message',
    expires: 'Expires',
    details: 'Card details',
    terms: 'Terms',
    loyaltyTerms: 'Points are redeemable in store only and have no cash value.',
    giftTerms: 'Store gift card. Not redeemable for cash.',
    balanceNow: 'Your balance is now %@',
    giftCard: 'Gift card',
    reward: 'Reward',
    open: 'Open card',
    remaining: 'To go',
    remainingStamps: 'stamps to reward',
    lifetime: 'Lifetime earned',
    info: 'Info',
    rewardReady: 'Reward ready',
  },
}

/* Fields shown on the card face and in the details section, per the merchant's design.
   Both wallets render these, so a card reads the same everywhere. */
export function loyaltyFields(model, tx) {
  const d = model.design
  const remaining = model.type === 'stamps' && model.stampsRequired ? Math.max(model.stampsRequired - model.balance, 0) : null
  const all = {
    member: { key: 'member', label: tx.member, value: model.memberName || '—' },
    remaining: remaining == null ? null : { key: 'remaining', label: tx.remaining, value: remaining === 0 ? tx.rewardReady : String(remaining) },
    lifetime: { key: 'lifetime', label: tx.lifetime, value: String(model.lifetime ?? 0) },
    code: { key: 'code', label: tx.code, value: model.code },
  }
  const front = d.front.map((k) => all[k]).filter(Boolean)
  const back = []
  if (model.message) back.push({ key: 'message', label: model.message.title, value: model.message.body })
  for (const k of d.back) {
    if (k === 'code') back.push({ key: 'code', label: tx.code, value: model.code })
    if (k === 'reward' && d.rewardText) back.push({ key: 'reward', label: tx.reward, value: d.rewardText })
    if (k === 'terms') back.push({ key: 'terms', label: tx.terms, value: tx.loyaltyTerms })
    if (k === 'link') back.push({ key: 'link', label: tx.details, value: model.url })
  }
  for (const [i, n] of d.notes.entries()) back.push({ key: `note${i}`, label: n.label, value: n.value })
  return { front, back }
}
