;(function () {
  'use strict'
  var project = 'yvqfq50f3e'
  var host = 'loyalty.mirqam.sa'
  var path = window.location.pathname
  if (window.location.hostname !== host || !/^\/blog\/[a-z0-9-]+\.html$/.test(path)) return
  if (window.location.hash && window.location.hash !== '#main') return
  var query = new URLSearchParams(window.location.search)
  var safe = true
  query.forEach(function (value, name) {
    if (!/^utm_(source|medium|campaign|content|term)$/.test(name) || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) safe = false
  })
  if (!safe || (document.referrer && /[?#]/.test(document.referrer))) return
  var consentKey = 'mirqam-clarity-consent-v1-' + project
  function read(key) {
    try {
      return localStorage.getItem(key)
    } catch (e) {
      return null
    }
  }
  function save(value) {
    try {
      localStorage.setItem(consentKey, value)
    } catch (e) {}
  }
  if (read('mirqam-analytics-consent-v1') !== 'granted' || document.getElementById('mq-clarity-choice')) return
  var active = false
  var panel = document.createElement('aside')
  panel.id = 'mq-clarity-choice'
  panel.className = 'mq-consent'
  panel.dir = 'rtl'
  panel.setAttribute('aria-label', 'خيارات تحليل تجربة المدونة')
  var text = document.createElement('p')
  text.textContent =
    'هل تسمح بتحليل تجربة المدونة باستخدام Microsoft Clarity؟ يساعدنا تسجيل النقرات والتمرير وخرائط التفاعل على تحسين المقالات. يُخفى محتوى الصفحة، ولا يعمل هذا التحليل في حسابك أو صفحات تسجيل الدخول. يمكنك الرفض أو سحب موافقتك لاحقًا.'
  var privacy = document.createElement('a')
  privacy.href = 'https://privacy.microsoft.com/privacystatement'
  privacy.textContent = 'خصوصية Microsoft'
  privacy.target = '_blank'
  privacy.rel = 'noopener noreferrer'
  var accept = document.createElement('button')
  accept.type = 'button'
  accept.textContent = 'قبول تحليل التجربة'
  var reject = document.createElement('button')
  reject.type = 'button'
  reject.textContent = 'رفض تحليل التجربة'
  var settings = document.createElement('button')
  settings.type = 'button'
  settings.className = 'mq-consent-settings'
  settings.textContent = 'خصوصية تجربة المدونة'
  settings.style.bottom = '48px'
  function start() {
    if (active || read('mirqam-analytics-consent-v1') !== 'granted') return
    active = true
    document.body.setAttribute('data-clarity-mask', 'true')
    window.clarity =
      window.clarity ||
      function () {
        window.clarity.q = window.clarity.q || []
        window.clarity.q.push(arguments)
      }
    window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' })
    var tag = document.createElement('script')
    tag.async = true
    tag.src = 'https://www.clarity.ms/tag/' + project
    document.head.appendChild(tag)
  }
  function close() {
    panel.hidden = true
    settings.hidden = false
  }
  function deny() {
    save('denied')
    close()
    if (active) {
      window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' })
      ;['_clck', '_clsk'].forEach(function (name) {
        ;[host, '.mirqam.sa'].forEach(function (domain) {
          document.cookie = name + '=; Max-Age=0; Path=/; Domain=' + domain + '; Secure; SameSite=Lax'
        })
      })
      window.location.reload()
    }
  }
  accept.onclick = function () {
    save('granted')
    start()
    close()
  }
  reject.onclick = deny
  settings.onclick = function () {
    panel.hidden = false
    settings.hidden = true
  }
  panel.appendChild(text)
  panel.appendChild(privacy)
  panel.appendChild(document.createElement('br'))
  panel.appendChild(accept)
  panel.appendChild(reject)
  document.body.appendChild(panel)
  document.body.appendChild(settings)
  var saved = read(consentKey)
  panel.hidden = !!saved
  settings.hidden = !saved
  if (saved === 'granted') start()
  document.addEventListener('click', function (event) {
    if (event.target && event.target.tagName === 'BUTTON' && event.target.textContent === 'رفض القياس') deny()
  })
})()

/* Public editorial measurement; no forms, customer identifiers, or account routes. */
;(function () {
  'use strict'
  var host = 'loyalty.mirqam.sa'
  var tiktok = 'DB5BOJRC77U33EAHFDB0'
  var snap = '2c4782a9-ef9d-473c-b817-ab1cbb97ab86'
  var meta = '3661074154048426'
  var key = 'mirqam-advertising-consent-v2-' + host
  var path = window.location.pathname
  if (window.location.hostname !== host || !/^\/blog\/[a-z0-9-]+\.html$/.test(path)) return
  if (window.location.hash && window.location.hash !== '#main') return
  var safe = true
  new URLSearchParams(window.location.search).forEach(function (value, name) {
    if (!/^utm_(source|medium|campaign|content|term)$/.test(name) || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) safe = false
  })
  if (!safe || (document.referrer && /[?#]/.test(document.referrer))) return
  function read(name) {
    try {
      return localStorage.getItem(name)
    } catch (e) {
      return null
    }
  }
  function save(value) {
    try {
      localStorage.setItem(key, value)
    } catch (e) {}
  }
  if (read('mirqam-analytics-consent-v1') !== 'granted' || window.__mirqamAdvertisingLoaded) return
  window.__mirqamAdvertisingLoaded = true
  var active = false
  var mounted = false
  var panel = document.createElement('aside')
  panel.id = 'mq-advertising-choice'
  panel.className = 'mq-consent'
  panel.dir = 'rtl'
  panel.setAttribute('aria-label', 'خيارات قياس الإعلانات')
  var text = document.createElement('p')
  text.textContent =
    'هل تسمح بقياس زيارات المدونة عبر TikTok وSnapchat وMeta؟ تُرسل بيانات الزيارة والجهاز وعنوان الشبكة إلى هذه المنصات لقياس الإعلانات. لا نرسل حقول النماذج أو بيانات حسابك. يمكنك الرفض أو سحب موافقتك لاحقًا.'
  var accept = document.createElement('button')
  accept.type = 'button'
  accept.textContent = 'قبول قياس الإعلانات'
  var reject = document.createElement('button')
  reject.type = 'button'
  reject.textContent = 'رفض قياس الإعلانات'
  var settings = document.createElement('button')
  settings.type = 'button'
  settings.className = 'mq-consent-settings'
  settings.style.bottom = '88px'
  settings.textContent = 'خصوصية الإعلانات'
  function start() {
    if (active || read('mirqam-analytics-consent-v1') !== 'granted') return
    active = true
    window.TiktokAnalyticsObject = 'ttq'
    window.ttq = window.ttq || []
    var ttq = window.ttq
    ttq.methods = [
      'page',
      'track',
      'identify',
      'instances',
      'debug',
      'on',
      'off',
      'once',
      'ready',
      'alias',
      'group',
      'enableCookie',
      'disableCookie',
      'holdConsent',
      'revokeConsent',
      'grantConsent',
    ]
    ttq.setAndDefer = function (t, e) {
      t[e] = function () {
        t.push([e].concat(Array.prototype.slice.call(arguments, 0)))
      }
    }
    var i = 0
    for (i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i])
    ttq.instance = function (t) {
      var e = ttq._i[t] || []
      var n = 0
      for (n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n])
      return e
    }
    ttq.load = function (id, options) {
      var url = 'https://analytics.tiktok.com/i18n/pixel/events.js'
      ttq._i = ttq._i || {}
      ttq._i[id] = []
      ttq._i[id]._u = url
      ttq._t = ttq._t || {}
      ttq._t[id] = +new Date()
      ttq._o = ttq._o || {}
      ttq._o[id] = options || {}
      var script = document.createElement('script')
      script.async = true
      script.src = url + '?sdkid=' + id + '&lib=ttq'
      document.head.appendChild(script)
    }
    ttq.disableCookie()
    ttq.load(tiktok)
    ttq.page()
    var snaptr =
      window.snaptr ||
      function () {
        if (snaptr.handleRequest) snaptr.handleRequest.apply(snaptr, arguments)
        else snaptr.queue.push(arguments)
      }
    window.snaptr = snaptr
    snaptr.queue = snaptr.queue || []
    var tag = document.createElement('script')
    tag.async = true
    tag.src = 'https://sc-static.net/scevent.min.js'
    document.head.appendChild(tag)
    snaptr('init', snap, {})
    snaptr('track', 'PAGE_VIEW')
    var fbq =
      window.fbq ||
      function () {
        if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments)
        else fbq.queue.push(arguments)
      }
    var metaTag
    if (!window.fbq) {
      window.fbq = fbq
      window._fbq = fbq
      fbq.push = fbq
      fbq.loaded = true
      fbq.version = '2.0'
      fbq.queue = []
      metaTag = document.createElement('script')
      metaTag.async = true
      metaTag.src = 'https://connect.facebook.net/en_US/fbevents.js'
      document.head.appendChild(metaTag)
    }
    fbq('consent', 'grant')
    fbq('set', 'autoConfig', false, meta)
    fbq('init', meta)
    fbq('trackSingle', meta, 'PageView')
  }
  function close() {
    panel.hidden = true
    settings.hidden = false
  }
  function deny() {
    save('denied')
    close()
    if (!active) return
    if (window.ttq && window.ttq.revokeConsent) window.ttq.revokeConsent()
    if (window.fbq) window.fbq('consent', 'revoke')
    document.cookie.split(';').forEach(function (cookie) {
      var name = cookie.trim().split('=')[0]
      if (!/^(_ttp|_tt_enable_cookie|_scid|_scid_r|_sc_cspv|_sc_cspv_r|_fbp|_fbc)$/.test(name)) return
      ;[host, '.mirqam.sa'].forEach(function (domain) {
        document.cookie = name + '=; Max-Age=0; Path=/; Domain=' + domain + '; Secure; SameSite=Lax'
      })
    })
    window.location.reload()
  }
  accept.onclick = function () {
    save('granted')
    start()
    close()
  }
  reject.onclick = deny
  settings.onclick = function () {
    panel.hidden = false
    settings.hidden = true
  }
  panel.appendChild(text)
  ;[
    ['خصوصية TikTok', 'https://www.tiktok.com/legal/page/row/privacy-policy/en'],
    ['خصوصية Snapchat', 'https://values.snap.com/privacy/privacy-policy'],
    ['خصوصية Meta', 'https://www.facebook.com/privacy/policy/'],
  ].forEach(function (entry) {
    var link = document.createElement('a')
    link.href = entry[1]
    link.textContent = entry[0]
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    panel.appendChild(link)
    panel.appendChild(document.createTextNode(' '))
  })
  panel.appendChild(document.createElement('br'))
  panel.appendChild(accept)
  panel.appendChild(reject)
  function mount() {
    if (mounted) return
    var clarityPanel = document.getElementById('mq-clarity-choice')
    if (clarityPanel && !clarityPanel.hidden) return
    mounted = true
    document.body.appendChild(panel)
    document.body.appendChild(settings)
    var saved = read(key)
    panel.hidden = !!saved
    settings.hidden = !saved
    if (saved === 'granted') start()
  }
  document.addEventListener('click', function (event) {
    if (event.target && event.target.tagName === 'BUTTON' && event.target.textContent === 'رفض القياس') deny()
    else mount()
  })
  mount()
})()
