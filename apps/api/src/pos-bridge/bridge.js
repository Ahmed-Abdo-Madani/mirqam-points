/* Runs on the destination product origin. No passwords or native session tokens
   are passed to POS. Embedding reuses the product's ordinary browser session. */
;(async () => {
  const $ = (id) => document.getElementById(id),
    params = new URLSearchParams(location.search)
  const config = await fetch('/pos/config', { cache: 'no-store' }).then((r) => r.json())
  const locale = new URLSearchParams(location.search).get('locale') === 'en' ? 'en' : 'ar',
    t = config.copy[locale]
  document.documentElement.lang = locale
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
  document.title = t.title
  document.getElementById('title').textContent = t.title
  document.querySelector('.brand span').textContent = t.brand
  const names = { bot: t.bot, marketing: t.marketing, loyalty: t.loyalty }
  const format = (s, data) => s.replace(/\{(\w+)\}/g, (_, k) => data[k] ?? '')
  const request = params.get('request'),
    link = params.get('link')
  let busy = false,
    loaded = false
  function headers() {
    const h = { Accept: 'application/json', 'Content-Type': 'application/json' }
    if (config.tokenKey) {
      const t = localStorage.getItem(config.tokenKey)
      if (t) h.Authorization = `Bearer ${t}`
    }
    return h
  }
  async function api(path, body) {
    const r = await fetch('/api/pos/' + path, {
      method: body ? 'POST' : 'GET',
      headers: headers(),
      credentials: 'same-origin',
      cache: 'no-store',
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const d = await r.json()
    if (!r.ok) throw Object.assign(new Error(t.errors[d.error] || d.message || t.failed), { status: r.status })
    return d
  }
  function action(label, href) {
    const a = document.createElement('a')
    a.textContent = label
    a.href = href
    a.target = '_blank'
    a.rel = 'noopener'
    $('actions').append(a)
  }
  function message(text) {
    $('message').textContent = text
  }
  async function check() {
    if (busy) return
    busy = true
    try {
      const me = await api('identity')
      $('actions').replaceChildren()
      if (link) {
        const verified = await api('links/' + encodeURIComponent(link) + '/check')
        if (!loaded) {
          $('application').src = verified.home
          loaded = true
        }
        $('bridge').hidden = true
        $('workspace').hidden = false
        return
      }
      const data = await api('requests/' + encodeURIComponent(request || ''))
      $('title').textContent = format(t.linkTitle, { app: names[config.product] })
      message(format(t.consent, { account: me.name, tenant: data.tenantName }))
      if (!me.canLink) {
        message(t.ownerOnly)
        action(t.open, config.home)
        return
      }
      const b = document.createElement('button')
      b.textContent = t.approve
      b.onclick = async () => {
        b.disabled = true
        try {
          const d = await api('authorize', { state: request, consent: true })
          const u = new URL(d.returnUrl)
          if (u.origin !== config.posOrigin || u.pathname !== '/marketplace/callback') throw Error(t.invalidDestination)
          location.replace(u.href)
        } catch (e) {
          message(e.message)
          b.disabled = false
        }
      }
      $('actions').append(b)
      action(t.cancel, config.posOrigin + '/marketplace')
    } catch (e) {
      if (link) {
        loaded = false
        $('application').removeAttribute('src')
        $('workspace').hidden = true
        $('bridge').hidden = false
      }
      $('actions').replaceChildren()
      if (e.status === 401) {
        message(t.loginHint)
        action(t.login, config.login)
        action(t.register, config.register)
      } else {
        message(e.message)
        action(t.back, config.posOrigin + '/marketplace')
        action(t.openApp, config.home)
      }
    } finally {
      busy = false
    }
  }
  await check()
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void check()
  })
  setInterval(() => {
    if (!document.hidden) void check()
  }, 15000)
})().catch(() => {
  document.getElementById('message').textContent = 'تعذّر تحميل صفحة الربط. افتح التطبيق مباشرة أو حاول لاحقًا.'
})
