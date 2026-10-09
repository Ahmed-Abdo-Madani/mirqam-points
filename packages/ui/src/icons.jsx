/* MIRQAM icon system (Icon Catalog 120, 2026) — ported from Mirqam Bot.
   Geometry on a 48-unit grid · 2.35 stroke · round caps & joins.
   The 45° qaf-diamond motif replaces circular dots and marks accents.
   Components accept className (size), strokeWidth and any SVG prop, mirroring
   the lucide-react API. Decorative by default (aria-hidden); pass aria-label
   and role="img" when an icon carries meaning on its own. */

/* Filled 45° diamond — the qaf motif used for dots, eyes, wheels, coins. */
function D({ x, y, r = 2.4 }) {
  return <path d={`M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`} fill="currentColor" stroke="none" />
}

function mq(children) {
  return function MqIcon({ className = 'h-5 w-5', strokeWidth = 2.35, ...rest }) {
    return (
      <svg
        viewBox="0 0 48 48"
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {children}
      </svg>
    )
  }
}
/* ---------- Arrows ---------- */
export const MqArrowDownLeft = mq(
  <>
    <path d="M30 18 18 30" />
    <path d="M27 30H18V21" />
  </>,
)
export const MqArrowUpLeft = mq(
  <>
    <path d="M30 30 18 18" />
    <path d="M27 18H18V27" />
  </>,
)
export const MqArrowLeft = mq(
  <>
    <path d="M38 24H10" />
    <path d="M20 14 10 24l10 10" />
  </>,
)
export const MqArrowRight = mq(
  <>
    <path d="M10 24h28" />
    <path d="M28 14l10 10-10 10" />
  </>,
)
export const MqChevronDown = mq(<path d="M13 19l11 11 11-11" />)
export const MqChevronUp = mq(<path d="M13 29l11-11 11 11" />)

/* ---------- Checks & status ---------- */
export const MqCheck = mq(<path d="M11 25.5l8.5 8.5L37 15" />)
export const MqCheckCheck = mq(
  <>
    <path d="M7 25l6.5 6.5L26 17" />
    <path d="M22 29.5l4.5 4.5L41 19" />
  </>,
)
export const MqCheckCircle = mq(
  <>
    <circle cx="24" cy="24" r="16" />
    <path d="M16.5 24.5l5.5 5.5 10-12" />
  </>,
)
export const MqX = mq(
  <>
    <path d="M14 14l20 20" />
    <path d="M34 14 14 34" />
  </>,
)
export const MqXCircle = mq(
  <>
    <circle cx="24" cy="24" r="16" />
    <path d="M18.5 18.5l11 11" />
    <path d="M29.5 18.5l-11 11" />
  </>,
)
export const MqAlertTriangle = mq(
  <>
    <path d="M24 9 42 39H6Z" />
    <path d="M24 20v8" />
    <D x={24} y={33.5} r={2.2} />
  </>,
)
export const MqInfo = mq(
  <>
    <circle cx="24" cy="24" r="16" />
    <path d="M24 22v10" />
    <D x={24} y={15} r={2.2} />
  </>,
)
export const MqHelpCircle = mq(
  <>
    <circle cx="24" cy="24" r="16" />
    <path d="M18.5 19a5.5 5.5 0 0 1 10.8 1.7c0 3.6-5.3 4.3-5.3 7.3" />
    <D x={24} y={33.5} r={2.2} />
  </>,
)
export const MqBadgeCheck = mq(
  <>
    <rect x="10.5" y="10.5" width="27" height="27" rx="7" />
    <rect x="10.5" y="10.5" width="27" height="27" rx="7" transform="rotate(45 24 24)" />
    <path d="M17.5 24.5l4.5 4.5 8.5-10" />
  </>,
)
export const MqShieldCheck = mq(
  <>
    <path d="M24 5.5 38 11v10.5c0 9.5-5.7 15.9-14 20-8.3-4.1-14-10.5-14-20V11Z" />
    <path d="M17.5 23.5l4.5 4.5 8.5-9.5" />
  </>,
)

/* ---------- Time & loading ---------- */
export const MqClock = mq(
  <>
    <circle cx="24" cy="24" r="16" />
    <path d="M24 14.5V24l6.5 4.5" />
  </>,
)
export const MqClock3 = mq(
  <>
    <circle cx="24" cy="24" r="16" />
    <path d="M24 14.5V24h8" />
  </>,
)
export const MqLoader = mq(<path d="M24 8a16 16 0 1 0 16 16" />)
export const MqRefresh = mq(
  <>
    <path d="M6 24a18 18 0 0 1 18-18 19.5 19.5 0 0 1 13.5 5.5L42 16" />
    <path d="M42 6v10H32" />
    <path d="M42 24a18 18 0 0 1-18 18 19.5 19.5 0 0 1-13.5-5.5L6 32" />
    <path d="M6 42V32h10" />
  </>,
)

/* ---------- Messaging ---------- */
export const MqSend = mq(
  <>
    <path d="M42 6 28 42l-7-16L5 19Z" />
    <path d="M42 6 21 26" />
  </>,
)
export const MqMessages = mq(
  <>
    <path d="M20 7h14a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6h-1" />
    <path d="M34 21v10a6 6 0 0 1-6 6H19l-8 7v-7a6 6 0 0 1-5-6V21a6 6 0 0 1 6-6h16a6 6 0 0 1 6 6Z" />
  </>,
)
export const MqMessageText = mq(
  <>
    <path d="M12 9h24a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H21l-9 8v-8a5 5 0 0 1-5-5V14a5 5 0 0 1 5-5Z" />
    <path d="M16 18h16" />
    <path d="M16 25h10" />
  </>,
)
export const MqMail = mq(
  <>
    <rect x="6" y="10" width="36" height="28" rx="5" />
    <path d="M9 14.5 24 26l15-11.5" />
  </>,
)
export const MqSmile = mq(
  <>
    <circle cx="24" cy="24" r="16" />
    <D x={18.5} y={19.5} r={2.1} />
    <D x={29.5} y={19.5} r={2.1} />
    <path d="M17 28a9.5 9.5 0 0 0 14 0" />
  </>,
)
export const MqMegaphone = mq(
  <>
    <path d="M6 21a3 3 0 0 1 3-3h4L39 8v32L13 30H9a3 3 0 0 1-3-3Z" />
    <path d="M15 30.5l2.5 8a3 3 0 0 0 5.8-1.8L21.5 31" />
  </>,
)
export const MqBot = mq(
  <>
    <rect x="9" y="17" width="30" height="21" rx="6" />
    <path d="M24 17v-6" />
    <D x={24} y={8} r={2.6} />
    <D x={18} y={26} r={2.2} />
    <D x={30} y={26} r={2.2} />
    <path d="M19 32h10" />
  </>,
)

/* ---------- Documents ---------- */
export const MqFileText = mq(
  <>
    <path d="M27 6H14a4 4 0 0 0-4 4v28a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V17Z" />
    <path d="M27 6v11h11" />
    <path d="M18 25h12" />
    <path d="M18 31h12" />
  </>,
)
export const MqScroll = mq(
  <>
    <path d="M34 42a4 4 0 0 0 4-4V10a4 4 0 0 0-4-4H14a4 4 0 0 0-4 4v28a4 4 0 0 0 4 4Z" />
    <path d="M18 16h12" />
    <path d="M18 23h12" />
    <path d="M18 30h8" />
  </>,
)
export const MqListChecks = mq(
  <>
    <path d="M21 13h19" />
    <path d="M21 24h19" />
    <path d="M21 35h19" />
    <path d="M7 11.5l3 3 5.5-6" />
    <path d="M7 22.5l3 3 5.5-6" />
    <path d="M7 33.5l3 3 5.5-6" />
  </>,
)
export const MqCopy = mq(
  <>
    <path d="M16 12v-1a5 5 0 0 1 5-5h14a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5h-1" />
    <rect x="8" y="16" width="24" height="24" rx="5" />
  </>,
)

/* ---------- Commerce ---------- */
export const MqShoppingCart = mq(
  <>
    <path d="M6 9h6l5.5 21H35l4-14H13.5" />
    <D x={19} y={37} r={2.6} />
    <D x={33} y={37} r={2.6} />
  </>,
)
export const MqShoppingBag = mq(
  <>
    <path d="M10 15h28l2.5 22.5a3.5 3.5 0 0 1-3.5 4.5H11a3.5 3.5 0 0 1-3.5-4.5Z" />
    <path d="M17 19v-4a7 7 0 0 1 14 0v4" />
  </>,
)
export const MqStore = mq(
  <>
    <path d="M7 16l4-9h26l4 9v3H7Z" />
    <path d="M10 19v21h28V19" />
    <path d="M20 40V29h8v11" />
  </>,
)
export const MqWallet = mq(
  <>
    <rect x="6" y="12" width="36" height="28" rx="5" />
    <path d="M42 22h-9a5 5 0 0 0 0 10h9" />
    <D x={33} y={27} r={2} />
  </>,
)
/* Discount ticket: inward notches on both long edges and a dashed perforation
   marking the tear-off stub. */
export const MqTicket = mq(
  <>
    <path d="M9 14h30a3 3 0 0 1 3 3v3.2a3.8 3.8 0 0 0 0 7.6V31a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-3.2a3.8 3.8 0 0 0 0-7.6V17a3 3 0 0 1 3-3Z" />
    <path d="M30 18.5v11" strokeDasharray="2 3" />
  </>,
)
/* Percent sign drawn with the qaf-diamond motif in place of the two dots. */
export const MqPercent = mq(
  <>
    <path d="M33 15 15 33" />
    <D x={16} y={16} r={2.6} />
    <D x={32} y={32} r={2.6} />
  </>,
)
export const MqPackageX = mq(
  <>
    <path d="M8 13l16-7.5L40 13v11" />
    <path d="M8 13v18l16 7.5 6-2.8" />
    <path d="M8 13l16 7.5L40 13" />
    <path d="M24 20.5V30" />
    <path d="M32 32l8 8" />
    <path d="M40 32l-8 8" />
  </>,
)
export const MqKeyRound = mq(
  <>
    <circle cx="15" cy="33" r="7.5" />
    <path d="M20.5 27.5 38 10" />
    <path d="M33 15l5 5" />
    <path d="M27.5 20.5l4 4" />
  </>,
)

/* ---------- Interface ---------- */
export const MqDashboard = mq(
  <>
    <rect x="7" y="7" width="15" height="18" rx="4" />
    <rect x="26" y="7" width="15" height="10" rx="4" />
    <rect x="26" y="21" width="15" height="20" rx="4" />
    <rect x="7" y="29" width="15" height="12" rx="4" />
  </>,
)
export const MqSettings = mq(
  <>
    <circle cx="24" cy="24" r="8.5" />
    <path d="M24 6.5v6" />
    <path d="M24 35.5v6" />
    <path d="M6.5 24h6" />
    <path d="M35.5 24h6" />
    <path d="M11.6 11.6l4.2 4.2" />
    <path d="M32.2 32.2l4.2 4.2" />
    <path d="M36.4 11.6l-4.2 4.2" />
    <path d="M15.8 32.2l-4.2 4.2" />
  </>,
)
export const MqMenu = mq(
  <>
    <path d="M10 15h28" />
    <path d="M10 24h28" />
    <path d="M10 33h20" />
  </>,
)
export const MqSearch = mq(
  <>
    <circle cx="21" cy="21" r="12.5" />
    <path d="M30.5 30.5 40 40" />
  </>,
)
export const MqPlus = mq(
  <>
    <path d="M24 12v24" />
    <path d="M12 24h24" />
  </>,
)
export const MqTrash = mq(
  <>
    <path d="M8 14h32" />
    <path d="M18 14v-3.5A3.5 3.5 0 0 1 21.5 7h5a3.5 3.5 0 0 1 3.5 3.5V14" />
    <path d="M13 14l2 24.5A4 4 0 0 0 19 42h10a4 4 0 0 0 4-3.5L35 14" />
    <path d="M20 22v13" />
    <path d="M28 22v13" />
  </>,
)
export const MqLogOut = mq(
  <>
    <path d="M20 8h-8a4 4 0 0 0-4 4v24a4 4 0 0 0 4 4h8" />
    <path d="M32 16l8 8-8 8" />
    <path d="M40 24H17" />
  </>,
)
export const MqLink = mq(
  <>
    <path d="M19 31h-5a8 8 0 0 1 0-16h5" />
    <path d="M29 15h5a8 8 0 0 1 0 16h-5" />
    <path d="M16 23h16" />
  </>,
)
export const MqDownload = mq(
  <>
    <path d="M24 8v19" />
    <path d="M15.5 19.5 24 28l8.5-8.5" />
    <path d="M10 38h28" />
  </>,
)
export const MqUpload = mq(
  <>
    <path d="M24 28V9" />
    <path d="M15.5 16.5 24 8l8.5 8.5" />
    <path d="M10 38h28" />
  </>,
)
export const MqLock = mq(
  <>
    <rect x="11" y="21" width="26" height="19" rx="5" />
    <path d="M17 21v-4.5a7 7 0 0 1 14 0V21" />
    <D x={24} y={30.5} r={2.4} />
  </>,
)
export const MqUser = mq(
  <>
    <circle cx="24" cy="15.5" r="8.5" />
    <path d="M9 40.5a15 15 0 0 1 30 0" />
  </>,
)
export const MqUsers = mq(
  <>
    <circle cx="18" cy="16.5" r="7.5" />
    <path d="M5 40a13 13 0 0 1 26 0" />
    <path d="M31.5 10.5a7.5 7.5 0 0 1 0 13.5" />
    <path d="M35.5 27.5A12.5 12.5 0 0 1 43 39" />
  </>,
)
export const MqUserPlus = mq(
  <>
    <circle cx="20" cy="15.5" r="8.5" />
    <path d="M6 40.5a14 14 0 0 1 28 0" />
    <path d="M37.5 14v10" />
    <path d="M32.5 19h10" />
  </>,
)
export const MqBell = mq(
  <>
    <path d="M24 7.5a11 11 0 0 1 11 11c0 8.5 2.5 12 4.5 14h-31c2-2 4.5-5.5 4.5-14a11 11 0 0 1 11-11Z" />
    <path d="M19.5 36.5a4.5 4.5 0 0 0 9 0" />
  </>,
)
export const MqClick = mq(
  <>
    <path d="M20 20 38 27l-8 3-3 8Z" />
    <path d="M19 7v5" />
    <path d="M7 19h5" />
    <path d="M9.5 9.5 13 13" />
    <path d="M28.5 9.5 25 13" />
  </>,
)
export const MqPencil = mq(
  <>
    <path d="M30.5 9.5 38.5 17.5 17 39l-9.5 1.5L9 31Z" />
    <path d="M26.5 13.5l8 8" />
    <D x={36.5} y={11.5} r={2} />
  </>,
)
export const MqPause = mq(
  <>
    <path d="M18 10v28" />
    <path d="M30 10v28" />
  </>,
)
export const MqPlay = mq(<path d="M15 9.5v29L39 24Z" />)

/* ---------- Devices & linking ---------- */
export const MqQrCode = mq(
  <>
    <rect x="8" y="8" width="12" height="12" rx="3" />
    <rect x="28" y="8" width="12" height="12" rx="3" />
    <rect x="8" y="28" width="12" height="12" rx="3" />
    <path d="M28 30h5" />
    <path d="M39 28v5" />
    <path d="M28 39h5" />
    <D x={36.5} y={36.5} r={2.6} />
  </>,
)
export const MqSmartphone = mq(
  <>
    <rect x="14" y="6" width="20" height="36" rx="5" />
    <path d="M21 36h6" />
  </>,
)
export const MqMonitor = mq(
  <>
    <rect x="6" y="9" width="36" height="24" rx="4" />
    <path d="M24 33v8" />
    <path d="M16 41h16" />
  </>,
)
export const MqPhone = mq(<path d="M11 7h7l3 9-5 4a24 24 0 0 0 12 12l4-5 9 3v7a4 4 0 0 1-4 4A33 33 0 0 1 7 11a4 4 0 0 1 4-4Z" />)
export const MqPhoneCall = mq(
  <>
    <path d="M9 10h6l2.5 7-4 3.5a20 20 0 0 0 10 10l3.5-4 7 2.5v6a3.5 3.5 0 0 1-3.5 3.5A28 28 0 0 1 5.5 13.5 3.5 3.5 0 0 1 9 10Z" />
    <path d="M28 10a10 10 0 0 1 10 10" />
    <path d="M28 3.5A16.5 16.5 0 0 1 44.5 20" />
  </>,
)
export const MqArchive = mq(
  <>
    <rect x="6" y="8" width="36" height="10" rx="3" />
    <path d="M8 18v17a5 5 0 0 0 5 5h22a5 5 0 0 0 5-5V18" />
    <path d="M19 25h10" />
  </>,
)
export const MqPlugZap = mq(
  <>
    <path d="M17 7v8" />
    <path d="M31 7v8" />
    <path d="M13 15h22v5a11 11 0 0 1-22 0Z" />
    <path d="M24 31v5a5 5 0 0 1-5 5h-3" />
    <path d="M38 27l-4 6h6l-4 6" />
  </>,
)
export const MqWifiOff = mq(
  <>
    <path d="M10 10l28 28" />
    <path d="M17.5 25.5a10.5 10.5 0 0 1 5-2.7" />
    <path d="M12 20a19 19 0 0 1 6.5-3.6" />
    <path d="M30 16.5A19 19 0 0 1 36 20" />
    <path d="M6.5 14.5A27 27 0 0 1 15 10" />
    <path d="M33 10a27 27 0 0 1 8.5 4.5" />
    <D x={24} y={35} r={2.6} />
  </>,
)
export const MqWebhook = mq(
  <>
    <circle cx="24" cy="11" r="5" />
    <circle cx="11" cy="35" r="5" />
    <circle cx="37" cy="35" r="5" />
    <path d="M21.5 15.5 13.5 30" />
    <path d="M26.5 15.5l8 14.5" />
    <path d="M16 35h16" />
  </>,
)

/* ---------- Media & misc ---------- */
export const MqImage = mq(
  <>
    <rect x="7" y="9" width="34" height="30" rx="5" />
    <D x={17} y={19} r={2.6} />
    <path d="M7 33l10-10 8 8 6-6 10 10" />
  </>,
)
export const MqMapPin = mq(
  <>
    <path d="M24 41c-8-6.5-13-12.6-13-19.5a13 13 0 0 1 26 0C37 28.4 32 34.5 24 41Z" />
    <D x={24} y={21} r={3} />
  </>,
)
export const MqPaperclip = mq(<path d="M42.9 22.1 24.5 40.5a12 12 0 0 1-17-17L24.6 6.4a8 8 0 1 1 11.3 11.3L18.7 34.8a4 4 0 0 1-5.7-5.7L29.9 12.2" />)
export const MqFlask = mq(
  <>
    <path d="M19 7h10" />
    <path d="M21 7v10L10.5 35.5A4.5 4.5 0 0 0 14.6 42h18.8a4.5 4.5 0 0 0 4.1-6.5L27 17V7" />
    <path d="M15 30h18" />
  </>,
)
export const MqGlobe = mq(
  <>
    <circle cx="24" cy="24" r="17" />
    <path d="M7 24h34" />
    <path d="M24 7a26 26 0 0 1 0 34" />
    <path d="M24 7a26 26 0 0 0 0 34" />
  </>,
)

/* ---------- Loyalty & gift cards (Mirqam Points) ---------- */
/* Wallet pass: card with a strip band and a diamond "chip". */
export const MqPass = mq(
  <>
    <rect x="9" y="6" width="30" height="36" rx="5" />
    <path d="M9 17h30" />
    <path d="M16 30h10" />
    <path d="M16 35h6" />
    <D x={31} y={32.5} r={3} />
  </>,
)
/* Gift: box with ribbon; the bow knot is a diamond. */
export const MqGift = mq(
  <>
    <rect x="7" y="17" width="34" height="9" rx="3" />
    <path d="M10 26v12a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V26" />
    <path d="M24 17v25" />
    <path d="M24 17c-3.5-7.5-12-8-12-2.5 0 2.5 3 2.5 12 2.5Z" />
    <path d="M24 17c3.5-7.5 12-8 12-2.5 0 2.5-3 2.5-12 2.5Z" />
  </>,
)
/* Coins stack — points balance. */
export const MqCoins = mq(
  <>
    <ellipse cx="19" cy="14" rx="11" ry="5" />
    <path d="M8 14v8c0 2.8 4.9 5 11 5" />
    <path d="M8 22v8c0 2.8 4.9 5 11 5" />
    <ellipse cx="30" cy="27" rx="11" ry="5" />
    <path d="M19 27v8c0 2.8 4.9 5 11 5s11-2.2 11-5v-8" />
    <D x={30} y={27} r={2} />
  </>,
)
/* Stamp card: 2×3 grid of diamonds, last one outlined (still to earn). */
export const MqStamp = mq(
  <>
    <rect x="6" y="11" width="36" height="26" rx="5" />
    <D x={15} y={20} r={3} />
    <D x={24} y={20} r={3} />
    <D x={33} y={20} r={3} />
    <D x={15} y={29} r={3} />
    <D x={24} y={29} r={3} />
    <path d="M33 26l3 3-3 3-3-3Z" />
  </>,
)
/* Tier crown with diamond jewels. */
export const MqCrown = mq(
  <>
    <path d="M8 16l8 9 8-13 8 13 8-9-3 21H11Z" />
    <path d="M11 37h26" />
    <D x={24} y={30} r={2.4} />
  </>,
)
/* Scanner frame with a scan line. */
export const MqScan = mq(
  <>
    <path d="M7 16v-5a4 4 0 0 1 4-4h5" />
    <path d="M32 7h5a4 4 0 0 1 4 4v5" />
    <path d="M41 32v5a4 4 0 0 1-4 4h-5" />
    <path d="M16 41h-5a4 4 0 0 1-4-4v-5" />
    <path d="M13 24h22" />
  </>,
)
/* Ledger: list with signed rows. */
export const MqLedger = mq(
  <>
    <rect x="8" y="6" width="32" height="36" rx="5" />
    <path d="M15 16h4" />
    <path d="M17 14v4" />
    <path d="M25 16h8" />
    <path d="M15 25h4" />
    <path d="M25 25h8" />
    <path d="M15 34h4" />
    <path d="M17 32v4" />
    <path d="M25 34h8" />
  </>,
)
/* Trend up with a diamond at the peak. */
export const MqTrendUp = mq(
  <>
    <path d="M6 36 18 24l7 7 13-14" />
    <path d="M30 16h9v9" />
    <D x={18} y={24} r={2.2} />
  </>,
)
/* Star built from the qaf diamond (rewards). */
export const MqReward = mq(
  <>
    <path d="M24 5l5.6 11.4L42 18.2l-9 8.8 2.1 12.4L24 33.6l-11.1 5.8L15 27l-9-8.8 12.4-1.8Z" />
    <D x={24} y={23} r={3} />
  </>,
)
/* Sun / moon for the theme control. */
export const MqSun = mq(
  <>
    <D x={24} y={24} r={7} />
    <path d="M24 5v5" />
    <path d="M24 38v5" />
    <path d="M5 24h5" />
    <path d="M38 24h5" />
    <path d="M10.6 10.6l3.5 3.5" />
    <path d="M33.9 33.9l3.5 3.5" />
    <path d="M37.4 10.6l-3.5 3.5" />
    <path d="M14.1 33.9l-3.5 3.5" />
  </>,
)
export const MqMoon = mq(<path d="M40 29A17 17 0 0 1 19 8a17 17 0 1 0 21 21Z" />)
export const MqLanguage = mq(
  <>
    <path d="M6 11h20" />
    <path d="M16 7v4" />
    <path d="M22 11c-1.5 7-6 13-14 17" />
    <path d="M11 17c2 4 5.5 7.5 10 9.5" />
    <path d="M26 41l8-19 8 19" />
    <path d="M29 34h10" />
  </>,
)
