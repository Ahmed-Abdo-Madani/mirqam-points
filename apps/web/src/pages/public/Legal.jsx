import { CompanyIdentity } from '@mirqam/ui'
import PublicShell from '../../components/PublicShell.jsx'
import { useI18n } from '../../i18n/index.jsx'
import content from './legal-content.js'

/** /privacy, /terms, /support — required public URLs for the App Store listing. */
export default function Legal({ doc }) {
  const { locale } = useI18n()
  const page = content[doc][locale]
  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-bold">{page.title}</h1>
        {page.updated && <p className="mt-2 text-sm text-muted">{page.updated}</p>}
        <div className="mt-8 grid gap-7">
          {page.sections.map(([heading, body]) => (
            <section key={heading}>
              <h2 className="text-lg font-bold">{heading}</h2>
              <p className="mt-2 leading-loose text-muted">{body}</p>
            </section>
          ))}
        </div>
        <div className="mt-12">
          <CompanyIdentity />
        </div>
      </article>
    </PublicShell>
  )
}
