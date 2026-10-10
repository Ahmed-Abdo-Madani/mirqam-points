;(() => {
  const html = document.documentElement
  const key = html.dataset.product === 'marketing' ? 'mirqam-marketing-landing-theme' : 'mirqam-theme'
  let theme = 'light'
  try {
    theme = localStorage.getItem(key) === 'dark' ? 'dark' : 'light'
  } catch {}
  html.dataset.theme = theme
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.querySelector('.theme-button')
    if (button) {
      const sync = () => button.setAttribute('aria-pressed', String(html.dataset.theme === 'dark'))
      sync()
      button.addEventListener('click', () => {
        html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark'
        try {
          localStorage.setItem(key, html.dataset.theme)
        } catch {}
        sync()
      })
    }
    const toc = document.querySelector('.toc details')
    if (toc && matchMedia('(max-width:760px)').matches) toc.open = false
  })
})()
