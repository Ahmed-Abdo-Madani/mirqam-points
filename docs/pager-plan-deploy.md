# Deploying the Mirqam Pager plan during the Frankfurt move

One page for the operator. The pager plan release adds **migration 018**
(`pager_subscriptions`, a new table that changes no existing one). The move's
copy step (`apps/api/src/db/copy-cli.js`) **refuses to run unless both databases
are at the same migration**, so the one rule is:

> **Both services (`mirqam-points` in Oregon and `mirqam-points-fra`) run the same commit before any copy, verify or cutover step.**

## Before you start

- [ ] Billing products exist: mirqam-billing lists the 8 `pager_*` products on the `loyalty` platform (shipped already).
- [ ] The POS API answers `POST /v1/loyalty-bridge/pager` with `401` without a key (shipped already).
- [ ] Owner go for the loyalty deploy (the deploy also ships a live update to the merchant app).
- [ ] Note which move phase you are in (RUNBOOK.md): standby (0–2), cutover (3), domain (4) or done.

## Environment (no new secret)

| Variable | Where | Value |
|---|---|---|
| `MIRQAM_POS_BRIDGE_KEY` | both services | already set for the POS bridge; the pager push reuses it. Must match the POS API's `MIRQAM_LOYALTY_BRIDGE_KEY`. |
| `MIRQAM_POS_API_URL` | optional, both | default `https://mirqam-api.onrender.com` |

Without the key the plan still works (trial, checkout), and the pager is simply not switched on in the POS yet. Each subscription shows `pos_bridge_unconfigured` and is retried every ≤15 minutes once the key is set.

## Deploy — move not started, or still in standby (phases 0–2)

1. Merge the PR.
2. `mirqam-points` (Oregon, live) → Manual Deploy → the merged commit. Boot applies 018 (`[db] applied 018-pager-plan.sql` in the logs).
   Check: `curl -s $ORE/api/health` → `"ok":true`.
3. `mirqam-points-fra` (standby) → Manual Deploy → **the same commit**. Standby never migrates; that's expected. The copy builds the target schema from this commit's migrations, so 018 is included.
   Check: `curl -s $FRA/api/health` → `"standby":true`.
4. If a rehearsal copy was already made, re-run it with `--replace` (the old copy has no 018). It must end with `ALL TABLES COPIED AND VERIFIED`, and `pager_subscriptions` is in the table list (tables are discovered, not listed by hand).
5. Smoke test on the website as an owner of a test workspace only: Billing → Mirqam Pager shows the cards and prices (29/49 per branch). Start the trial **only** on the pager test workspace.

## Deploy — during the write freeze (phase 3)

Don't. Finish the cutover first, or roll it back, then deploy as below.

## Deploy — after cutover (Frankfurt live, Oregon forwarding)

1. `mirqam-points-fra` (live) → Manual Deploy → the merged commit (applies 018).
2. `mirqam-points` (forwarder) → Manual Deploy → **the same commit**. It never opens the database. Deploying it anyway keeps rollback B (RUNBOOK.md) safe: Oregon comes back on the same code, and the optional reverse copy from Frankfurt needs both sides at the same migration.
3. Smoke test as in step 5 above.

## What runs where

- Billing webhooks (`/api/billing/hooks`) and the pager lifecycle job run **only on the live service**: read-only, standby and forward modes run no jobs. A webhook that reaches Oregon after cutover is forwarded to Frankfurt.
- The lifecycle job ends lapsed trials and retries failed POS pushes every ≤15 min, so a push lost during a deploy heals by itself.

## Rollback

- Code: deploy the previous commit to **both** services. Migration 018 stays: it's forward-only, and the old code ignores the table.
- A pager subscription bought in between stays in billing. Its entitlement is re-read when the new code returns (`/api/billing/pager/confirm`, or the lifecycle sync).
- Never delete `pager_subscriptions` rows by hand. To switch the pager off for one business, cancel the subscription in HQ billing; the webhook does the rest.
