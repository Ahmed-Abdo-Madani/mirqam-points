---
title: Phones use three bottom tabs with Scan in the middle; admin pages open from Home
author: Ahmed-Abdo-Madani
date: 2026-11-16
branch: cashier-tab-layout
cost: { minutes: 53, tokens: 594504 }
id: l-5d9c1afd
scope: repo
status: active
src: agent
touches:
  - apps/api/migrations/017-rewards.sql
  - apps/api/src/account-deletion.js
  - apps/api/src/account-deletion.test.js
  - apps/api/src/ledger.js
  - apps/api/src/routes/ledger.js
  - apps/api/src/routes/members.js
  - apps/api/src/routes/programs.js
  - apps/web/src/components/EntriesTable.jsx
  - apps/web/src/components/Rewards.jsx
  - apps/web/src/i18n/ar.js
---

## Decided
On phones and in the mobile app the console uses three bottom tabs (Home, Scan in the middle, Settings) instead of the side drawer. This copies the layout counter staff already know from other Saudi loyalty apps, so stores need no retraining. Admin pages (programs, campaigns, staff, gift cards, activity, billing) open from shortcuts on Home. The desktop keeps the side menu.
The customer screen follows the same order: profile card, three tiles (balance, available rewards, past redemptions), Add/Redeem switch, one stepper plus confirm button, latest 6 transactions.

## Watch out
Several stamps in one order go to the server as `visits` (1-20); the server multiplies stampsPerVisit, so cashiers still never type a stamp count the server doesn't price. `visits` and `purchaseMinor` can't be sent together.
The Settings tab is a short page; the full Settings page (with in-app account deletion, required by the App Store) must stay one tap away from it.
The web WhatsApp bubble is lifted above the tab bar inside /app on phones.

In the code: apps/web/src/components/AppShell.jsx (BottomTabs, useNavItems), apps/web/src/pages/app/Cashier.jsx, apps/web/src/pages/app/Preferences.jsx, apps/api/src/routes/ledger.js (earnBody.visits), apps/api/src/routes/members.js (accounts[].redemptions).
