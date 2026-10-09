# Mirqam Points — Implementation Plan

> Loyalty & gift-card platform with Apple Wallet and Google Wallet passes.
> Third product in the Mirqam family: `bot.mirqam.sa` (WhatsApp messaging), `marketing.mirqam.sa`, `mirqam.sa` (umbrella, in development).
> Working name **Mirqam Points / مرقام نقاط**, suggested host **`points.mirqam.sa`** (assumption, see §12).
> Written after reviewing `cartat_clone` (the Mirqam Bot repo): `DESIGN_TOKENS.md`, `src/styles.css`, `src/components/ui`, `AGENTS.md`, `RESUME.md`, `render.yaml`, `DEV_MIRQAM_SA_PLAN.md`, `server/auth.js`.

---

## 1. Product scope

**Merchants (tenants)** create loyalty programs. **Customers** hold them as passes in Apple Wallet / Google Wallet. A cashier scans the pass to earn or redeem.

| Module | What it does |
|---|---|
| Points programs | Earn rules (per SAR spent, per visit, bonus campaigns), redemption rewards, expiry, tiers |
| Stamp cards | "Buy 9, get the 10th free" variant of the same engine |
| Gift cards | Sell and issue stored-value cards (fixed or custom amounts), balance, partial redemption, top-up, expiry |
| Wallet passes | Per-merchant branded passes, updated live when balance or points change |
| Cashier app | Mobile-first PWA: scan, look up by phone, earn, redeem, void |
| Merchant console | Programs, members, rewards, transactions, campaigns, reports, staff and roles, branches |
| Integrations | Salla/Zid orders (earn automatically), WhatsApp via bot.mirqam.sa, segments and campaigns via marketing.mirqam.sa, public REST API and webhooks |
| Admin | Super-admin: tenants, plans, wallet-issuer health, audit |

**Out of scope for v1:** coalition or multi-merchant shared points, a consumer app, cash-out of gift cards, NFC / Smart Tap, in-house POS hardware. Each can follow once the core ledger is proven.

---

## 2. Findings from the reference repo that shape this plan

1. **Design is token-driven and already documented.** `DESIGN_TOKENS.md` and the `@theme` block in `src/styles.css` define the palette, type, radii, motion and accessibility rules. Reuse the tokens, not the CSS file.
2. **`styles.css` is not safe to copy wholesale.** After the `@theme` block it accumulates layered overrides (`.mq-*`, `.ct-*`, `#root .…` specificity patches, dark mode done by overriding Tailwind utility classes). The newer `mirqam-glass.css` re-skins on top of that. Extract the tokens and primitives into a clean shared package; do not inherit the override stack.
3. **The bot's datastore is a JSONB document store** (or a JSON file in dev). That is the wrong shape for money and points. A loyalty ledger needs real transactions, constraints and idempotency, so this project uses **relational Postgres**.
4. **Auth is bearer tokens stored in the bot datastore.** There is no cross-subdomain session, and no SSO between the Mirqam products yet. The bot does have a `mintMagicCode` / `consumeMagicCode` handoff (used for marketplace installs) that can serve as the interim bridge (§5).
5. **Reusable infrastructure on bot.mirqam.sa:** WhatsApp sending, Moyasar billing, Salla/Zid OAuth and signed order webhooks, the embeddable widget, and the `/api/v1` integration platform (flag-gated, `INTEGRATION_API_ENABLED`). Points should consume these over the network and not duplicate them.
6. **Working conventions to copy:** a mandatory post-edit verification gate (`verify.mjs` boots the server in simulation mode and runs an HTTP battery), a pre-push hook, a `Dockerfile` + `render.yaml` blueprint, Biome, Vitest, Playwright.
7. **`marketing.mirqam.sa` is not in that repo**, so I could not inspect it. Integration with it is designed against a contract (§7) that needs confirming with whoever owns it.

---

## 3. Architecture

```
                    ┌───────────────────────── points.mirqam.sa ─────────────────────────┐
 Customer phone     │  Public pages (enroll / claim / gift-card landing)  ── React SPA   │
 (Apple/Google      │  Merchant console  ── React SPA (RTL, same shell language as bot)  │
  Wallet)  ◄────── pass │  Cashier PWA       ── React SPA, camera scanner                │
                    │              │                                                     │
                    │        Express API (Node ESM)  ── /api/*  and public /api/v1       │
                    │   ┌──────────┼───────────┬───────────────┬──────────────┐          │
                    │ Ledger   Wallet svc   Gift cards     Integrations   Jobs/queue     │
                    │ engine   (Apple+GW)   (sale/redeem)  (Salla/Zid/WA)  (expiry, push) │
                    └───────────┬─────────────────────────────────────────────────────────┘
                          Postgres (relational)      Object storage (logos, pass assets)
                                │
        bot.mirqam.sa (WhatsApp, Moyasar, Salla/Zid) · marketing.mirqam.sa · Apple APNs · Google Wallet API
```

### Stack decisions (defaults, chosen so nothing is left to guess)

| Concern | Choice | Why |
|---|---|---|
| Repo | New repo `mirqam-points` (this folder) | Same pattern as the bot; separate deploy |
| Frontend | React 18 + Vite 7 + Tailwind 4 + react-router 6 | Identical to bot, so the design primitives port directly |
| Backend | Node ESM + Express 4 | Same as bot; team already operates it |
| DB | **Postgres, relational**, plain SQL migrations | Ledger integrity (see finding 3) |
| Jobs | Postgres-backed queue (`pg-boss` or equivalent) | No new infrastructure; needed for pass pushes, expiry, webhooks with retries |
| Pass signing | `passkit-generator` (Apple) and the Google Wallet REST API with a service account | Standard, maintained options; verify before committing |
| Hosting | Render Docker web service plus managed Postgres, same account and region as the bot | One dashboard; mirrors `render.yaml` |
| i18n | Arabic-first, RTL; English second | Same as every Mirqam product |
| Lint/test | Biome, Vitest, Playwright | Same as bot |

**Shared design package.** Create `@mirqam/ui` as the single source of the design language: tokens (CSS `@theme`), `Button`, `Card`, `Badge`, `Input`, `Field`, `Modal`, `Menu`, `EmptyState`, `Toast`, `Avatar`, the `Mq*` icon set, `Pattern`, `Logo`, `CompanyIdentity`, and the dark-theme and motion-preference controls. Start by copying from `cartat_clone` into this repo's `packages/ui`. Later the bot adopts it, so the three products stop drifting.

---

## 4. Design language (to follow exactly)

From `DESIGN_TOKENS.md` and `styles.css`:

- **Palette:** NAVY `#172740` (primary actions), INK `#0e1726` (sidebar, hero, toasts), TEAL `#23949a` (focus, indicators, large text), ACCESSIBLE TEAL `#0f6f74` / `#177e83` (small teal text, links), CLOUD `#f5f7f8` (page), ICE `#eaf4f4` (tinted panels), SLATE `#69788a` (secondary text). Functional pairs ok/warn/err/info. **65% white / 25% navy / 10% teal.** Primary buttons are navy; teal is reserved for active states, links and focus.
- **Type:** IBM Plex Sans Arabic; a display slot reserved for Graphik Arabic. Arabic line-height 1.4 (headings) to 1.8 (body). Western digits and `.tnum` for numbers (balances, points).
- **Shape:** 8px grid, radii 12–16px, fields 46px tall, glass-surface cards with a 1px line and soft shadow, floating rounded top bar and navy glass sidebar (the `mirqam-glass` look).
- **Icons:** `Mq*` set, 48-unit grid, stroke 2.35, qaf-diamond motif. **Patterns:** `waves`, `diamonds` at 5–18% opacity.
- **Motion:** hover 120–180 ms, enter 200–300 ms ease-out, exit ease-in. **Modal anti-flicker rule:** scale-only entry, opaque from frame one, no `backdrop-blur` on the scrim. `prefers-reduced-motion` honoured, plus the manual "pause motion" control.
- **Accessibility (WCAG 2.2):** teal focus ring, skip links, `role="dialog"`, `aria-live` toasts, `aria-label` on icon buttons.
- **Themes:** light default, explicit persistent dark via `html[data-theme]`. In the new package, define dark values as **CSS variables** per token, not by overriding utility classes as the bot does.
- **Brand shell:** `Logo` (wordmark + product label "نقاط / LOYALTY & GIFT CARDS"), `CompanyIdentity` footer block (legal name, CR 7055011105, address) on every public page.

**The one place we deliberately leave the Mirqam palette:** the wallet passes themselves. They carry the *merchant's* logo and colours (white-label), exactly as the inbox keeps WhatsApp colours as a documented exception. Pass layout and typography stay consistent; Mirqam appears only as a small "Powered by Mirqam" mark, which a plan can remove.

### Screens to design first (before Phase 1 build)
1. Merchant console shell (sidebar + floating top bar + welcome band)
2. Program builder (rules, rewards, tiers) with a **live pass preview** (Apple and Google side by side)
3. Members list + member 360 drawer (mirrors the bot's customers 360)
4. Cashier PWA: scan → customer → earn/redeem
5. Gift-card sale page (public), gift-card management
6. Public enrollment landing ("Add to Apple Wallet" / "Add to Google Wallet")
7. Admin overview

---

## 5. Identity, tenancy and SSO across Mirqam products

- **Tenant = merchant account**, same concept as a bot account. Staff roles: owner, manager, cashier (branch-scoped), analyst.
- **Phase 0–2 (interim):** own email + password auth (scrypt, same as bot), httpOnly cookie sessions (stronger than the bot's bearer tokens). Add **"continue from Mirqam Bot"**, using the bot's existing magic-code handoff, so a bot merchant lands in Points already linked to their account.
- **Target (Phase 6, requires owner decision, §12):** a single Mirqam identity provider (OIDC) hosted on `mirqam.sa` once that site exists, with a session cookie scoped to `.mirqam.sa` so the three products share login. Design Points' auth behind a small interface now so swapping is a one-module change.
- **Linking table:** `external_links(tenant_id, product, external_account_id)` records the bot and marketing account that belong to this tenant.

---

## 6. Core domain model (relational, money-safe)

```
tenants, users, memberships(role, branch scope), branches
programs(tenant, type: points|stamps, currency_rules, expiry_policy, status)
tiers(program, name, threshold, multiplier, perks)
rewards(program, cost_points, kind, value, stock)
members(tenant, phone_e164 UNIQUE per tenant, name, email, birth_date, consent flags, locale)
member_accounts(member, program, points_balance, lifetime_points, tier)   -- cached, derived from ledger
ledger_entries(id, tenant, account, kind earn|redeem|expire|adjust|void,
               amount, balance_after, source(pos|salla|zid|api|campaign),
               idempotency_key UNIQUE, ref, actor, created_at)            -- append-only
gift_cards(tenant, code_hash, balance_minor, currency, status, expires_at, buyer, recipient, order_ref)
gift_card_entries(card, kind issue|redeem|topup|refund|void, amount_minor, idempotency_key UNIQUE, ...)
passes(member/gift_card, platform apple|google, serial, auth_token, push_token(s), last_updated_tag)
orders/payments(gift-card sales via Moyasar), webhook_events(deduped), audit_log, api_keys
```

Rules that are non-negotiable:
- **Append-only ledger**; balances are derived and cached, reconciled by a nightly job. Corrections are new `adjust`/`void` entries, never edits.
- **Every mutation takes an `Idempotency-Key`**, enforced by a unique constraint. Scanners retry on bad networks; Salla/Zid redeliver webhooks.
- **Gift-card amounts in integer halalas** (minor units). No floats anywhere in money or points.
- **Row-level locking** (`SELECT … FOR UPDATE` on the account) for redeem; reject any redeem that would overdraw.
- **Gift-card codes:** high-entropy random, stored hashed, displayed once; the pass carries a signed, short-lived-checkable payload, not the raw secret. Rate-limit lookups.
- **PDPL:** consent captured at enrollment (marketing separately from transactional), export and delete per member, retention policy, minimal PII on the pass itself.

---

## 7. Integrations

| System | Direction | Use | Notes |
|---|---|---|---|
| **Apple Wallet** | out | Create `.pkpass`, host the PassKit web service (register/unregister device, list updated serials, fetch latest pass), push via APNs on balance change | Needs Apple Developer account, Pass Type ID cert, WWDR cert |
| **Google Wallet** | out | Loyalty and Gift Card classes/objects, "Save to Google Wallet" JWT links, `PATCH` object on change | Needs Google Wallet issuer account, service account, issuer approval for production |
| **bot.mirqam.sa** | out | Send WhatsApp messages (pass link on enrollment, points earned, reward unlocked, gift-card delivery, expiry reminders) | Needs a service-to-service token and a documented endpoint; likely a new narrow endpoint in the bot repo. **Any bot change must pass that repo's `verify.mjs` gate** |
| **Salla / Zid** | in | Earn points automatically on completed orders; optional native coupon for rewards | Reuse the bot's signed-webhook patterns. Decide whether Points connects to the stores directly (own OAuth app) or receives forwarded events from the bot (§12) |
| **Moyasar** | out/in | Gift-card purchases (mada, Apple Pay, cards), refunds, signed webhooks | Same provider as bot billing; per-endpoint webhook secret; fail closed without it |
| **marketing.mirqam.sa** | both | Expose members/segments (consented only) and events (`points.earned`, `tier.changed`, `member.birthday`); accept campaign-triggered bonus points | Contract to be agreed (§12); until then ship signed outbound webhooks and a read API |
| **Public API `/api/v1`** | in | Earn/redeem/lookup for third-party POS and ecommerce | API keys per tenant, scoped, rate-limited, OpenAPI doc site like `docs-site/` |

---

## 8. Phased build plan

Effort is given for **one full-stack engineer working with an AI coding agent**; halve the calendar time with two people. Start the external approvals (marked ⏳) on day 1: they gate Phase 2 and run in parallel.

### Phase 0: Foundations (≈1–1.5 wk)
- Repo, workspace layout (`apps/web`, `apps/api`, `packages/ui`, `packages/shared`), Biome, Vitest, Playwright, Dockerfile, `render.yaml` (web service + Postgres, same region as bot), CI.
- Port tokens and primitives into `packages/ui`; set up Storybook-style gallery page (`/_design`) that renders every primitive in light, dark, RTL and LTR, as the visual contract.
- Postgres schema v1 + migration runner; auth (email/password, cookie sessions), tenants, roles.
- **Verification gate**, mirroring the bot: `node scripts/verify.mjs` boots the API in simulation mode (fake wallet signer, fake Moyasar, fake WhatsApp) on an ephemeral DB and runs the HTTP battery; pre-push hook blocks on failure.
- ⏳ Kick off: Apple Developer enrollment and Pass Type ID, Google Wallet issuer account, `points.mirqam.sa` DNS, Moyasar sub-account/keys, bot-repo service token.
- **Exit:** empty branded shell deployed at the staging URL; gate green; gallery page approved by the owner.

### Phase 1: Ledger and merchant console (≈2.5–3 wk)
- Ledger engine (earn, redeem, adjust, void, expire) with idempotency and locking; property tests for balance invariants.
- Program builder: points and stamps; earn rules; rewards; tiers; expiry policy.
- Members: create, import CSV, list/search, member 360 drawer, manual adjustment with reason + audit.
- Console shell, dashboard (active members, points issued vs redeemed, liability), transactions table, reports export.
- **Exit:** a merchant can configure a program and manage members and balances entirely in simulation; ledger reconciliation job passes.

### Phase 2: Wallet passes (≈2.5–3 wk, needs ⏳ approvals)
- Pass designer: logo, colours, strip image, fields, back-of-pass text, barcode type; live preview.
- **Google Wallet first** (API-driven, quickest to prove): class creation per program, object per member, save-link, update on ledger change.
- **Apple Wallet:** `.pkpass` generation and signing, PassKit web service endpoints, APNs push, update flow, expiry and voiding.
- Enrollment flow: public landing and QR → phone number (+ optional OTP via bot WhatsApp) → consent → pass offered per device.
- **Exit:** real passes install on real iPhone and Android devices and **update within seconds** after an earn. This needs a device test checklist, not just automated tests.

### Phase 3: Cashier app and earn/redeem (≈2 wk)
- Cashier PWA (installable, RTL, large touch targets): camera scan (QR/Code128 from pass), phone lookup, amount entry, earn/redeem with confirmation, void within window, branch and staff attribution.
- Offline-tolerant queue with idempotency keys; clear "pending sync" state.
- Public `/api/v1` earn/redeem/lookup + API keys + docs site.
- **Exit:** full in-store loop on a real device: scan → earn → pass updates → redeem reward.

### Phase 4: Gift cards (≈2.5 wk)
- Gift-card products (fixed denominations and custom amounts, min/max, expiry, design per merchant).
- Public purchase page → Moyasar checkout → webhook → issue card → deliver by WhatsApp/email → add to wallet.
- Redeem (full and partial) at cashier and via API; balance check; top-up; refund and void flows.
- Fraud controls: code entropy, hashed storage, rate limits, lockout, admin freeze.
- ⏳ Tax/regulatory review (§10) must conclude before launch to real merchants.
- **Exit:** buy → receive → redeem to zero → reconciles with Moyasar settlement report.

### Phase 5: Engagement and ecosystem (≈2.5–3 wk)
- WhatsApp notifications through bot.mirqam.sa with templates (welcome, earned, reward ready, expiring, birthday, gift received).
- Salla/Zid auto-earn; referral rewards; bonus-points campaigns; segments.
- marketing.mirqam.sa contract implemented (events out, segments out, campaign-triggered bonus in).
- Pass push messages (Apple) and Google Wallet messages / "offer" notifications within provider limits.
- **Exit:** an order on a test Salla store earns points, pass updates, WhatsApp message arrives.

### Phase 6: Billing, admin, SSO, hardening, launch (≈2.5–3 wk)
- Plans and metering (members, passes, gift-card volume, branches, API calls), trial, Moyasar subscription billing, entitlements (pattern: bot's `featureEntitlements.js`).
- Super-admin: tenants, plans, issuer and APNs health, failed-push queue, audit viewer.
- Mirqam identity: OIDC provider or `.mirqam.sa` shared cookie, depending on §12 decision.
- Security review, load test (pass-update fan-out), backups/PITR drill, runbooks, legal pages (privacy, terms, refund, gift-card terms), accessibility pass, English locale QA.
- **Exit:** acceptance checklist (§11) complete; production at `points.mirqam.sa`.

**Total ≈ 14–17 weeks** for one engineer + agent (≈ 9–11 with two). The critical path is not code. It is **Apple and Google approvals and the gift-card regulatory answer**; start them in week 1.

---

## 9. Testing and quality gates

- **Gate (every edit):** `node scripts/verify.mjs`, exit code inspected, zero `FAIL` lines. Add it to `AGENTS.md` for this repo the same way the bot does.
- **Unit (Vitest):** ledger invariants (no negative balance, idempotent replay returns the original result, concurrent redeems), earn-rule math, tier transitions, expiry, gift-card partial redemption, money in halalas.
- **API battery:** enrollment, earn, redeem, void, gift-card sale → redeem, webhook dedupe, RBAC (cashier cannot see other branches), cross-tenant isolation.
- **E2E (Playwright):** console flows in RTL and LTR, light and dark; cashier PWA at phone viewport; visual snapshots of the gallery page.
- **Real-device checklist (manual, per release):** install, update, remove and re-add pass on iOS and Android; scan from a pass in bright light; airplane-mode cashier queue.
- **Simulation mode** for wallet signing, APNs, Google API, Moyasar and WhatsApp so CI never needs credentials, which is the same contract the bot uses.

---

## 10. Security, privacy and compliance

- **Secrets** (Apple `.p12`/keys, Google service-account JSON, Moyasar, bot token, `SECRET_KEY`): Render env vars only, never in the repo; encrypt tenant-level credentials at rest (AES-256-GCM, as the bot does). Rotate Apple and Google credentials on a schedule; alert before expiry. **Apple pass certificates expire yearly; an expired cert silently stops all pass updates**, so monitor it.
- **Multi-tenancy:** every query tenant-scoped; add Postgres row-level security as defence in depth; a test that fails if any route lacks a tenant guard.
- **Abuse:** rate limits on scan/lookup/enroll endpoints; OTP before first pass issuance to stop phone-number harvesting; velocity checks on earn (per member, per cashier).
- **Webhooks** fail closed without their secret in production.
- **PDPL:** consent records, purpose limitation (marketing vs transactional), member export/erase, DPA template for merchants (they are the controller, Mirqam the processor), data-residency check with hosting region.
- **Gift cards (needs legal confirmation before launch):** 15% VAT treatment and ZATCA e-invoicing at sale; whether single-merchant closed-loop stored value falls outside SAMA licensing for each merchant's use; expiry and refund rules under Saudi consumer-protection regulation; breakage accounting. **I have not verified these; they must be confirmed with a Saudi legal/tax adviser.**
- **Supply chain:** pinned dependencies, lockfile, `npm audit` in CI, CSP with a tight `script-src`.

---

## 11. Acceptance checklist (definition of done)

- [ ] Staging and production live at `points.mirqam.sa`, TLS valid, health check wired.
- [ ] All UI uses `@mirqam/ui` tokens; gallery page matches bot's navy/teal/IBM Plex look in light and dark, RTL and LTR; no hardcoded colours outside the pass designer.
- [ ] Ledger invariants proven by tests; nightly reconciliation job green; idempotent on replay.
- [ ] Real Apple and Google passes install, update within seconds, and survive remove/re-add.
- [ ] Cashier PWA completes the scan-earn-redeem loop on a real phone, including offline queue.
- [ ] Gift-card purchase → delivery → partial and full redemption → Moyasar reconciliation verified.
- [ ] Salla/Zid order earns points; duplicate webhook does not double-earn.
- [ ] WhatsApp notifications flow through bot.mirqam.sa; marketing.mirqam.sa contract implemented.
- [ ] RBAC and cross-tenant isolation tests pass; security review findings closed.
- [ ] Cert and credential expiry monitoring in place.
- [ ] Privacy, terms, refund and gift-card terms published; PDPL flows (export/erase) work; legal sign-off on gift cards.
- [ ] `verify.mjs` exits 0 with zero `FAIL` lines in CI and via pre-push hook.
- [ ] Backups/PITR restore drilled; runbooks written.

---

## 12. Decisions and inputs needed from you

I proceeded on defaults so the plan is complete; please confirm or change these, **in this priority order**:

1. **Name and host.** Defaults: *Mirqam Points / مرقام نقاط* at `points.mirqam.sa`. (The folder is named "mirqam point".) Alternatives: `loyalty.mirqam.sa`, `wallet.mirqam.sa`.
2. **Who are the customers?** Default assumption: **merchants who run their own programs** (SaaS, like the bot), not a Mirqam-run shared programme. This drives the whole tenancy model.
3. **Apple / Google accounts.** Do you already have an Apple Developer Program account and a Google Wallet issuer account? Under whose legal entity (شركة مرقام التجارية)? These take days to weeks to approve and gate Phase 2.
4. **Gift-card legal position.** Who confirms the VAT/ZATCA/SAMA questions in §10, and by when? This gates Phase 4 launch, not the build.
5. **SSO ambition.** Interim magic-code handoff from the bot (default) vs. building a Mirqam-wide OIDC login now. The latter is cleaner but depends on `mirqam.sa` progress.
6. **Salla/Zid.** Should Points register its **own** Salla/Zid apps (independent, more app-store work), or receive forwarded order events from the bot (faster, couples the two)? Default: forwarded events via the bot for v1.
7. **marketing.mirqam.sa.** Who owns it, what stack, and what integration shape do they want? I could not inspect it.
8. **Pricing model.** Per-member tiers, flat plans, or a gift-card transaction fee? Affects Phase 6 metering.
9. **Pilot merchant.** A real merchant (or two) to test with from Phase 2 will improve the pass and cashier design more than any amount of speculation.
10. **Monorepo vs. separate `@mirqam/ui` repo.** Default: package lives in this repo's workspace now, extracted to its own repo when the bot adopts it.

---

## 13. Main risks

| Risk | Impact | Mitigation |
|---|---|---|
| Apple/Google approval delays | Blocks Phase 2 | Apply in week 1; build and test everything else in simulation; Google first |
| Expired Apple cert or APNs failure | Passes silently stop updating | Expiry monitoring, health page, alerting |
| Double-earn / double-redeem | Direct money loss | Idempotency keys, row locks, append-only ledger, reconciliation |
| Gift-card regulation / tax | Launch blocked or fines | Legal review in parallel, ship points first (Phases 1–3) as a standalone release |
| Pass-update fan-out (a campaign touches 100k passes) | APNs / Google rate limits, slow jobs | Queue with batching and backoff, per-tenant throttle, load test in Phase 6 |
| Design drift between three products | Inconsistent brand | Shared `@mirqam/ui` package, visual gallery in CI |
| Coupling to bot (WhatsApp, Salla) | Cascading outages | Queue + retry, circuit breaker, degrade gracefully (passes keep working) |
| Scope creep (coalition points, NFC, consumer app) | Delays | Explicit v1 out-of-scope list in §1 |

---

## 14. First week, concretely

1. Confirm §12 items 1–3; submit Apple and Google applications; create DNS and Render services.
2. Scaffold repo + `packages/ui` from `cartat_clone` (tokens, Button/Card/Badge/Input/Field/Modal/Menu/EmptyState/Toast, Mq icons, Pattern, Logo, CompanyIdentity).
3. Build the gallery page; review it against the bot's live look.
4. Write Postgres schema v1 and the ledger engine with its invariant tests (before any UI).
5. Stand up `verify.mjs`, pre-push hook, and CI.
