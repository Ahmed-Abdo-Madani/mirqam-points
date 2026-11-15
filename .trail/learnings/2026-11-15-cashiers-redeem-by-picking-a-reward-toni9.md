---
title: Cashiers redeem by picking a reward; the server prices it
author: Toni9
date: 2026-11-15
branch: feat/rewards-catalogue
cost: { minutes: 30, tokens: 251683 }
id: l-816ed585
scope: repo
status: active
src: agent
touches:
  - apps/api/migrations/017-rewards.sql
  - apps/api/src/routes/programs.js
  - apps/api/src/routes/ledger.js
  - apps/api/src/ledger.js
  - apps/web/src/components/Rewards.jsx
  - apps/web/src/pages/app/Cashier.jsx
---

## Decided
Redemptions can name a catalogue reward (free item, % off, or SAR off). The cashier picks the reward and a quantity, and the server prices it as cost × quantity. Cashiers never type the number, just as they never type points to earn. A typed number stays available as a fallback for programs with no rewards.

Rewards live in their own table, not in the program's config JSON, so a ledger entry can point at the reward it paid for and history can show the reward's name.

## Watch out
The redeem idempotency hash only includes the reward id and quantity when a reward is given. If they were always appended, a retry of a plain redemption minted before the deploy would hash differently and fail with idempotency_mismatch.

Archiving a reward hides it from the cashier, but past entries still reference it. The purge must delete ledger entries before rewards.

In the code: apps/api/migrations/017-rewards.sql, apps/api/src/routes/programs.js (reward routes), apps/api/src/routes/ledger.js (redeem), apps/api/src/ledger.js (requestParts), apps/web/src/components/Rewards.jsx.
