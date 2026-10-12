# Mirqam Points · مرقام نقاط

Loyalty programs and gift cards that live in Apple Wallet and Google Wallet —
part of the Mirqam platform family: [WhatsApp customer service](https://bot.mirqam.sa/),
[accounting](https://pos.mirqam.sa/), [marketing](https://marketing.mirqam.sa/), [real estate operations](https://aqar.mirqam.sa/),
and [Mirqam](https://mirqam.sa/). Plan and roadmap: [PLAN.md](./PLAN.md). Agent rules: [AGENTS.md](./AGENTS.md).

Official website: [Mirqam Loyalty](https://loyalty.mirqam.sa/) · [Arabic loyalty guides](https://loyalty.mirqam.sa/blog/index.html).

## Official product references · مراجع منصات مرقام

Each product has its own scope, onboarding checklist, official site and editorial guides:

- [Mirqam Bot · مرقام بوت](docs/ecosystem/mirqam-bot.md)
- [Mirqam Mohasbi · مرقام محاسبي](docs/ecosystem/mohasbi.md)
- [Mirqam Marketing · مرقام تسويق](docs/ecosystem/mirqam-marketing.md)
- [Mirqam Loyalty · مرقام ولاء](docs/ecosystem/mirqam-loyalty.md)
- [Mirqam Aqar · مرقام عقار](docs/ecosystem/mirqam-aqar.md)

These are first-party product references maintained by Mirqam, not independent reviews. Review each platform’s current checkout for available packages and activation. Eligibility and paid annual-offer terms are documented at [mirqam.sa](https://mirqam.sa/services/annual-offer).

## Status

| Phase | State |
|---|---|
| 0 · Foundations (workspace, `@mirqam/ui`, schema, auth, gate, CI, deploy files) | done |
| 1 · Ledger & merchant console (programs, members, earn/redeem/adjust/void, staff, activity) | core done — rewards catalogue, tiers, expiry, CSV import still to come |
| 2 · Wallet passes (Google, Apple) | not started — blocked on issuer accounts |
| 3 · Cashier PWA (scanner, offline queue), public API | desk cashier only |
| 4–6 | not started |

## Run locally

Requires Node 22+. No database to install: development uses PGlite (real
Postgres in WASM), persisted in `.data/pg`.

```bash
npm install
npm run dev:api      # API on http://localhost:4100
npm run dev          # console on http://localhost:5174 (proxies /api)
node scripts/seed-dev.mjs   # optional demo workspace (credentials inside the script)
```

Useful pages: `/` landing · `/register` · `/app` console · `/design` design-system gallery.

## Verify

```bash
node scripts/verify.mjs
```

Unit tests → HTTP battery on a throwaway server → web build. Exit 0 required.
`npm run hooks:install` makes `git push` run it automatically.

## Deploy

`render.yaml` provisions the Docker web service `mirqam-points` and the
Postgres `mirqam-points-db` (Oregon, same account and region as Mirqam Bot) on
`loyalty.mirqam.sa`. DNS: `loyalty CNAME mirqam-points.onrender.com`.
