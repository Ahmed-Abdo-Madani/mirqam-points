/* Mirqam's official commercial identity, the issuer on documents (receipts) and the same
   facts packages/ui/src/brand.jsx CompanyIdentity shows on public pages. There is no VAT
   registration number: never print one until Mirqam supplies it. */
export const COMPANY = Object.freeze({
  legalName: Object.freeze({ ar: 'شركة مرقام التجارية', en: 'Mirqam Company Commercial' }),
  /** السجل التجاري / CR No. (الرقم الوطني الموحد / Unified National No.) */
  crNumber: '7055011105',
  address: Object.freeze({
    ar: 'مبنى 8145، شارع المصيف 54، حي المصيف، الرمز البريدي 39913، حفر الباطن، المملكة العربية السعودية',
    en: 'Building 8145, Al Masif 54 St., Al Masif Dist., Postal Code 39913, Hafar Al Batin, Kingdom of Saudi Arabia',
  }),
  email: 'contact.bot@mirqam.sa',
})
