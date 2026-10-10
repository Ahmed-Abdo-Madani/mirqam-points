#!/usr/bin/env node
/* App Store screenshots (iPhone 6.3": 1179×2556 by default) of the real app, rendered by
   headless Chrome over the DevTools protocol against the LOCAL dev stack.
   Prereqs: npm run dev:api, npm run dev, node scripts/seed-dev.mjs
   Usage: node scripts/store-screenshots.mjs [--locale ar|en]  → dist-apps/screenshots/<locale>/ */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO } from './demo-account.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WEB = 'http://localhost:5174'
const locale = process.argv.includes('--locale') ? process.argv[process.argv.indexOf('--locale') + 1] : 'ar'
// iPhone 6.1"/6.3" (1179×2556) by default — App Store Connect's current base size. --size 6.9 gives 1290×2796.
const SIZE =
  process.argv.includes('--size') && process.argv[process.argv.indexOf('--size') + 1] === '6.9'
    ? { w: 430, h: 932, tag: '6.9' }
    : { w: 393, h: 852, tag: '6.3' }
const OUT = join(ROOT, 'dist-apps', 'screenshots', `${locale}-${SIZE.tag}`)
mkdirSync(OUT, { recursive: true })

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = 9333
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(tmpdir(), `mp-shots-${Date.now()}`)}`, '--hide-scrollbars', 'about:blank'],
  {
    stdio: 'ignore',
  },
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let target
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200)
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})
const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value
const go = async (path, settle = 1800) => {
  await cdp('Page.navigate', { url: `${WEB}${path}` })
  await sleep(settle)
}
const shot = async (name) => {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`saved ${locale}/${name}.png`)
}
/* React-controlled inputs need the native value setter + an input event. */
const typeInto = (selector, value) =>
  evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
  )
const clickText = (text) =>
  evaluate(
    `(() => { const el = [...document.querySelectorAll('button, a')].find(e => e.textContent.trim().includes(${JSON.stringify(text)})); if (el) el.click(); return Boolean(el) })()`,
  )

try {
  await cdp('Page.enable')
  await cdp('Runtime.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: SIZE.w, height: SIZE.h, deviceScaleFactor: 3, mobile: true })
  await cdp('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  })
  await go('/login', 1200)
  await evaluate(`localStorage.setItem('mirqam-theme', 'light'); localStorage.setItem('mirqam-locale', '${locale}'); true`)
  const login = await evaluate(
    `fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify({ email: DEMO.owner.email, password: DEMO.owner.password })}) }).then(r => r.status)`,
  )
  if (login !== 200) throw new Error(`login failed: ${login}`)

  // A couple of gift cards so the gift screen is not empty.
  const giftCount = await evaluate(`fetch('/api/gift-cards').then(r => r.json()).then(j => j.total)`)
  if (!giftCount) {
    for (const [amountMinor, recipientName] of [
      [20000, 'سارة'],
      [50000, 'عبدالله'],
      [10000, 'Lina'],
    ]) {
      await evaluate(
        `fetch('/api/gift-cards', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ amountMinor: ${amountMinor}, recipientName: '${recipientName}' }) }).then(r => r.status)`,
      )
    }
  }

  await go('/app', 2500)
  await shot('1-dashboard')

  await go('/app/cashier', 2000)
  await typeInto('input', '0501112233')
  await clickText(locale === 'ar' ? 'بحث' : 'Find')
  await sleep(2000)
  await typeInto('input[inputmode=decimal]', '45.50')
  await sleep(600)
  await shot('2-cashier')

  const memberId = await evaluate(`fetch('/api/members/lookup?phone=%2B966501112233').then(r => r.json()).then(m => m.id)`)
  await go(`/app/members/${memberId}`, 2500)
  await shot('3-member')
  await clickText(locale === 'ar' ? 'البطاقة' : 'Card')
  await sleep(1500)
  await shot('4-wallet-card')

  await go('/app/gift-cards', 2500)
  await shot('5-gift-cards')

  const passPath = await evaluate(
    `fetch('/api/members/${memberId}').then(r => r.json()).then(m => m.accounts.find(a => a.program.type === 'stamps')?.passPath)`,
  )
  await go(passPath, 2500)
  await shot('6-customer-card')
} finally {
  ws.close()
  chrome.kill()
}
