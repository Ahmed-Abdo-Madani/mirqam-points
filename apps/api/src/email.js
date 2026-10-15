/* Transactional email through Resend's REST API (same provider as the other
   Mirqam products). Without RESEND_API_KEY the mailer reports not-ready and
   callers record the email as skipped; nothing here ever throws into a request. */
export function createMailer({ config, fetcher = fetch }) {
  const key = config.resendApiKey || ''
  const from = config.emailFrom || 'Mirqam <no-reply@mirqam.sa>'
  return {
    ready: Boolean(key),
    async send({ to, subject, html }) {
      if (!key) return { ok: false, reason: 'not_configured' }
      try {
        const res = await fetcher('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, html }),
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return { ok: false, reason: `resend_${res.status}` }
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: err.message }
      }
    },
  }
}
