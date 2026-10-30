import PublicShell from '../../components/PublicShell.jsx'
import content from './legal-content.js'

/* /delete-account — public, no sign-in (Google Play's account-deletion URL). Arabic
   first, English below, whatever the interface language; mirrors account-deletion.js.
   The shell's footer carries the company identity (name, CR number, address, contact). */
function Version({ lang }) {
  const page = content.deleteAccount[lang]
  const Title = lang === 'ar' ? 'h1' : 'h2'
  return (
    <section lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'} className="text-start">
      <Title className="text-3xl font-bold">
        {page.title} · {page.app}
      </Title>
      <p className="mt-2 text-sm font-semibold text-muted">{page.developer}</p>
      <p className="mt-6 leading-loose">{page.intro}</p>
      <div className="mt-8 grid gap-7">
        {page.sections.map((s) => (
          <section key={s.heading}>
            <h3 className="text-lg font-bold">{s.heading}</h3>
            {s.body && <p className="mt-2 leading-loose text-muted">{s.body}</p>}
            {s.steps && (
              <ol className="mt-2 grid list-decimal gap-1.5 ps-6 leading-loose text-muted">
                {s.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
            {s.items && (
              <ul className="mt-2 grid list-disc gap-1.5 ps-6 leading-loose text-muted">
                {s.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </section>
  )
}

export default function DeleteAccount() {
  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-6 py-14">
        <Version lang="ar" />
        <hr className="my-14 border-line" />
        <Version lang="en" />
      </article>
    </PublicShell>
  )
}
