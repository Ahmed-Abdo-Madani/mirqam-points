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
