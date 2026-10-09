/* Runs before first paint (external file so the CSP needs no 'unsafe-inline'). */
;(() => {
  const html = document.documentElement
  try {
    html.dataset.theme = localStorage.getItem('mirqam-theme') === 'dark' ? 'dark' : 'light'
    const locale = localStorage.getItem('mirqam-locale') === 'en' ? 'en' : 'ar'
    html.lang = locale
    html.dir = locale === 'ar' ? 'rtl' : 'ltr'
  } catch {
    html.dataset.theme = 'light'
  }
})()
