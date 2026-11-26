/* Rubber-stamp payment status on a document. The kind always comes from the server,
   computed from a real record (a receipt is «paid» only because its payment settled);
   an unknown kind draws nothing rather than a guess. */
const KINDS = new Set(['paid', 'unpaid', 'void'])

export function PaymentStamp({ kind, main, sub, detail }) {
  if (!KINDS.has(kind)) return null
  return (
    <div className="doc-stamp-zone">
      <div className={`doc-stamp doc-stamp--${kind}`} role="img" aria-label={main}>
        <span className="doc-stamp-main">{main}</span>
        {sub && <span className="doc-stamp-sub">{sub}</span>}
        {detail && <span className="doc-stamp-detail num">{detail}</span>}
      </div>
    </div>
  )
}
