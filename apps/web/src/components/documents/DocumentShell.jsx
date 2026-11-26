/* Chrome-less A4 documents (receipts). The stylesheet is injected as a marked
   <style data-doc-css> so print, the screen and the downloaded PDF (lib/doc-pdf.js
   inlines exactly this sheet) share one source. The paper keeps a fixed light palette
   whatever the console theme; the toolbar is console UI and is never printed. */
import docCss from './mq-doc.css?inline'

export function DocumentShell({ locale, status, toolbar, notice, children }) {
  return (
    <div className="mq-doc-view">
      <style data-doc-css="">{docCss}</style>
      {toolbar && <div className="mq-doc-toolbar no-print border-b border-line bg-surface/95">{toolbar}</div>}
      {notice && <div className="mq-doc-notice no-print px-4">{notice}</div>}
      <div className="mq-doc" dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale} data-status={status}>
        {children}
      </div>
    </div>
  )
}

/** One A4 page; its content lays out in the 186mm x 273mm sheet inside the margins. */
export function DocPage({ children }) {
  return (
    <div className="doc-page">
      <div className="doc-sheet">{children}</div>
    </div>
  )
}

/** A label in the reader's language followed by the other language, smaller. */
export function Bi({ main, sub }) {
  return (
    <>
      {main}
      {sub && sub !== main && (
        <>
          {' '}
          <span className="sub">{sub}</span>
        </>
      )}
    </>
  )
}
