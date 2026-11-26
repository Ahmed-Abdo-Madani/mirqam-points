---
title: "The pager is billed as its own sub-account on the loyalty billing platform, and billing amounts include VAT"
author: Ahmed-Abdo-Madani
date: 2026-11-26
branch: feat/pager-plan
cost: { minutes: 29, tokens: 55254 }
id: l-5dc6bc81
scope: repo
status: active
src: agent
touches:
  - tests/http/billing.mjs
  - apps/api/migrations/018-pager-plan.sql
  - apps/api/src/account-deletion.js
  - apps/api/src/app.js
  - apps/api/src/billing-remote.js
  - apps/api/src/config.js
  - apps/api/src/main.js
  - apps/api/src/pager-plan.js
  - apps/api/src/pager-plan.test.js
  - apps/api/src/routes/billing.js
---

## Decided
- Mirqam Pager is sold through mirqam-billing on the existing `loyalty` platform, under the account ref `pager:<tenant>` with `parent_ref` = the workspace. Billing allows one subscription per account, so a separate ref is the only way to have loyalty and the pager at once without touching the loyalty subscription. No new platform key or webhook secret is needed.
- Extra branches are an add-on product (`<plan>_branch`) with quantity = branches - 1, because billing checkouts take add-on quantities but not a plan quantity.
- Prices live once in packages/shared/src/pager-plans.js, excluding VAT. mirqam-billing stores VAT-inclusive amounts (it derives VAT as 15/115 of the total), so the seed amounts are price × 1.15.

## Watch out
- Billing webhooks for `pager:*` arrive on the same /api/billing/hooks. The loyalty apply() must ignore refs containing ':'; otherwise it would cast `pager:<uuid>` to a uuid, error, and billing would retry forever.
- The verify gate's unit stage times out in hooks when the machine is busy (another session running a NestJS suite). The files pass on their own. Don't chase those as regressions.

In the code: apps/api/src/pager-plan.js, apps/api/src/billing-remote.js (onSubAccount, subAccountCheckout), project_move_over billing/seed/platforms.json (pager_* products).
