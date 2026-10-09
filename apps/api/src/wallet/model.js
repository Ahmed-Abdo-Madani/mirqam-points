/* Platform-neutral pass model. Apple and Google renderers consume this, so a
   pass looks and reads the same in both wallets. */
import { int } from '../db/index.js'

export const DEFAULT_DESIGN = { background: '#172740', foreground: '#ffffff', label: '#8ac0c4' }
const HEX = /^#[0-9a-fA-F]{6}$/

export function normalizeDesign(raw = {}) {
  const d = { ...DEFAULT_DESIGN }
  for (const k of ['background', 'foreground', 'label']) if (HEX.test(raw?.[k] ?? '')) d[k] = raw[k].toLowerCase()
  if (typeof raw?.rewardText === 'string' && raw.rewardText.trim()) d.rewardText = raw.rewardText.trim().slice(0, 140)
  return d
}

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
  SELECT a.id, a.balance, a.lifetime_earned, a.code, a.pass_token, a.apple_auth, a.pass_version, a.updated_at,
         m.name AS member_name, m.locale, p.id AS program_id, p.name AS program_name, p.type, p.config, p.design,
         t.name AS merchant, t.slug
    FROM accounts a
    JOIN members m ON m.id = a.member_id
    JOIN programs p ON p.id = a.program_id
    JOIN tenants t ON t.id = a.tenant_id`

export function loyaltyModel(row, publicUrl) {
  return {
    kind: 'loyalty',
    id: row.id,
    serial: loyaltySerial(row.id, row.pass_version),
    version: row.pass_version,
    authToken: row.apple_auth,
    merchant: row.merchant,
    programId: row.program_id,
    programName: row.program_name,
    type: row.type,
    balance: int(row.balance),
    stampsRequired: row.type === 'stamps' ? row.config?.stampsRequired : null,
    memberName: row.member_name || '',
    locale: row.locale || 'ar',
    barcode: `MP:${row.code}`,
    code: row.code,
    design: normalizeDesign(row.design),
    url: `${publicUrl}/p/${row.pass_token}`,
    updatedAt: new Date(row.updated_at),
  }
}

export const GIFT_SQL = `
  SELECT g.*, t.name AS merchant, t.slug FROM gift_cards g JOIN tenants t ON t.id = g.tenant_id`

export function giftModel(row, code, publicUrl) {
  return {
    kind: 'gift',
    id: row.id,
    serial: giftSerial(row.id),
    authToken: row.apple_auth,
    merchant: row.merchant,
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
  },
}
