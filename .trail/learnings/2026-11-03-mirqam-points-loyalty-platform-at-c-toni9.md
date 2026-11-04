---
title: "Mirqam Points loyalty platform at C:\\dev\\mirqam point"
author: Toni9
date: 2026-11-03
id: l-7364bbb7
scope: repo
status: active
touches:
  - PLAN.md
---

## Decided
Mirqam Points (loyalty, stamps, gift cards in Apple/Google Wallet) is the third Mirqam product, alongside bot.mirqam.sa (repo: C:\Users\toni9\OneDrive\Documents\cartat_clone, app in `_staging/rebuild`) and marketing.mirqam.sa (not available locally; owner/stack unknown). mirqam.sa itself is still in development.

Phase 0 and the Phase 1 ledger core were built on 2026-10-09 after the user said "start implementing", without answering the PLAN.md §12 questions. These defaults are therefore **unconfirmed**: name "Mirqam Points / مرقام نقاط", host points.mirqam.sa, SaaS model where merchants run their own programs, Render Oregon next to the bot, interim auth (no SSO yet), CompanyIdentity contact email copied from the bot ([email]).

**Why:** the user wanted momentum over upfront answers. Apple Developer / Google Wallet issuer accounts and the gift-card legal review are the real blockers for Phase 2 and Phase 4.

## Watch out
before Phase 2 (wallet passes), ask about issuer accounts. Re-raise the unconfirmed defaults when they start to matter (DNS, legal pages, pricing). The design language must stay in sync with the bot; see mirqam-design-language.

_From Claude Code's memory of this repo, last updated Oct 9._
