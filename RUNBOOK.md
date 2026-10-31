# Mirqam Points — operations runbook

## Move to Frankfurt (Oregon → Frankfurt, 2026-11)

Points and its Postgres move from Render **Oregon** to **Frankfurt** (next to
the POS API and the bot, ~3× closer to Saudi merchants). Render cannot change
a region in place, so new resources are added next to the old ones and the
old web service becomes a **forwarder**.

| | Oregon (today) | Frankfurt (after) |
|---|---|---|
| Web service | `mirqam-points` (`srv-db4k1g59fdbs73fj62sg`) → forwarder | `mirqam-points-fra` |
| Database | `mirqam-points-db` (`dpg-db4k1bc9v7es738c40bg-a`) → rollback copy | `mirqam-points-db-fra` |
| Hostname | `mirqam-points.onrender.com` (stays, forwards) | `mirqam-points-fra.onrender.com` |
| `loyalty.mirqam.sa` | attached here until phase 4 | attached here from phase 4 |

**Targets:** reads never stop; writes are frozen for ~5–10 minutes (phase 3);
installed apps keep working throughout; no secret passes through the
operator.

### How the code supports it

- **Runtime modes** (`apps/api/src/runtime-mode.js`, chosen at boot by `apps/api/src/server.js`):
  - *standby* — `mirqam-points-fra` declares `MIRQAM_REQUIRE_LIVE=1`; until `MIRQAM_LIVE=1` it answers `/api/health` only (`"standby":true`): no database connection, no migration, no background job.
  - *read-only* — `MIRQAM_READ_ONLY=1`: reads work, every `/api` write returns `503 {"error":"maintenance"}` (Arabic/English copy in the app), the database session is read only, and no background job runs (billing lifecycle, deletion sweep, commerce worker). `/api/health` shows `"readOnly":true`.
  - *forward* — `FORWARD_TO=https://mirqam-points-fra.onrender.com`: every request (API, webhooks, Apple Wallet, live updates, streams) is proxied with its body, status and headers; never opens the database. Responses carry `x-mirqam-forwarder: 1`. The original client IP and host travel in a header signed with `SECRET_KEY`, so Frankfurt keeps per-client rate limits, same-origin checks, the hq-entry host check and billing return URLs exactly as before. `GET /__forwarder/health` is answered locally.
  - Background jobs therefore only ever run on the one live service.
- **Data copy** (`apps/api/src/db/copy-cli.js`), run inside `mirqam-points-fra` where `DATABASE_URL` (Frankfurt, internal) and `SOURCE_DATABASE_URL` (Oregon, external, pasted by the owner) already are — nobody handles a connection string:
  - `node apps/api/src/db/copy-cli.js` — copy into an empty target. `--replace` — re-copy over a previous run. `--verify` — compare only.
  - Target schema from the app's own migrations; refuses unless both databases are at the same migration (same release). Source read in one consistent snapshot; target written in **one transaction** (foreign keys dropped and re-created = re-validated, identity sequences set, every table verified by row count + checksum before COMMIT). Any failure leaves the target unchanged. Refuses a live target and the same database as source. Never prints connection strings.
  - Success line: `ALL TABLES COPIED AND VERIFIED (N tables, M rows)`; verify: `SOURCE AND TARGET MATCH`.
  - No shell? Set `MIRQAM_COPY_ON_BOOT=copy|replace|verify` on the standby service, deploy, and read the `[copy]` lines in its logs (honoured in standby only; remove it afterwards).
- **Mobile:** the next live-update bundle calls `https://loyalty.mirqam.sa` (`apps/web/.env.mobile`), so app traffic follows the domain to Frankfurt. The native live-update URL of the store builds already installed stays `https://mirqam-points.onrender.com/api/mobile/live-update` — that is why Oregon keeps running as the forwarder. `apps/mobile/capacitor.config.json` now points the *next store build* at `https://loyalty.mirqam.sa/api/mobile/live-update`. Native requests use bearer tokens and the webview origins in `MOBILE_ORIGINS`, so they work on any host; web sessions are host-only cookies, unaffected by the move.

Who: **Op** = operator (Render dashboard / Chrome; no secrets). **Owner** = Ahmed (secrets, DNS at sahara.com.sa).
Shortcuts below: `ORE=https://mirqam-points.onrender.com`, `FRA=https://mirqam-points-fra.onrender.com`.

### Phase 0 — merge and create (no downtime) — Op

1. Merge the PR. Open Blueprints → the Points blueprint → sync (it may run by itself on merge). The plan must show **only** *create* `mirqam-points-fra` and *create* `mirqam-points-db-fra`. If it lists **any** change to `mirqam-points` or `mirqam-points-db` (domains, env vars, plan, auto-deploy, database name/user), cancel and report — render.yaml was written to match the live Oregon settings (auto-deploy off, `mirqam_points_db` / `mirqam_points_db_user`, both domains). If it asks for `MIRQAM_LIVE`, `SOURCE_DATABASE_URL` or `SECRET_KEY`, leave them empty (Owner fills them in phase 1). If Render rejects the database plan name `0.1c-256mb` for a new database, use `basic-256mb`.
2. Wait for the first deploy of `mirqam-points-fra`. Check: `curl -s $FRA/api/health` → `{"ok":true,"standby":true,...}`.
3. `mirqam-points` → Manual Deploy → *Deploy latest commit* (no env change). Behaviour is unchanged; it ships the read-only/forward code and the new live-update bundle (API base `loyalty.mirqam.sa`, which Oregon serves today). Check: `curl -s $ORE/api/health` → `"ok":true` without `readOnly`; sign in on https://loyalty.mirqam.sa; open the app and confirm it still loads data (after it picked up the update, it calls `loyalty.mirqam.sa`).

### Phase 1 — secrets and database access (no downtime)

4. **Owner:** in `mirqam-points-fra` → Environment, add every variable that `mirqam-points` has, with identical values, **except** `DATABASE_URL`, `NODE_ENV`, `PUBLIC_URL`, `TRUST_PROXY` (the blueprint sets those) and never `MIRQAM_READ_ONLY` / `FORWARD_TO`. `SECRET_KEY` must be byte-identical (gift-card codes are sealed with it; the forwarder signs with it). Typical keys: `SECRET_KEY`, `BILLING_URL`, `BILLING_API_KEY`, `BILLING_WEBHOOK_SECRET`, `MOYASAR_SECRET_KEY`, `MOYASAR_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `BILLING_ENFORCE`, `BILLING_TRIAL_DAYS`, `APPLE_*`, `GOOGLE_WALLET_*`, `SOCIAL_*`, `MIRQAM_POS_BRIDGE_KEY`, `MIRQAM_COMMERCE_KEY`, `EXTRA_ORIGINS`, `MOBILE_ORIGINS`, `AUTH_RATE_LIMIT`, `SESSION_TTL_DAYS`.
5. **Owner:** `mirqam-points-db` → Connect → copy the **External** Database URL → paste it into `mirqam-points-fra` → Environment as `SOURCE_DATABASE_URL`. Save (any save option; standby ignores it until used).
6. **Op:** `mirqam-points-fra` → Connect → *Outbound* → note its outbound IP ranges. `mirqam-points-db` → Networking / Access Control → add each range (description `mirqam-points-fra copy — remove after move`). Today that list is **empty, which blocks every external connection** — without this step the copy cannot reach Oregon.
7. **Op:** `PUBLIC_URL` on `mirqam-points-fra` is `https://loyalty.mirqam.sa` (the live site); Oregon's blueprint value is `https://points.mirqam.sa`, a hostname without DNS. New wallet passes, gift-card links and payment return/callback URLs will therefore use `loyalty.mirqam.sa`. Nothing to do unless the Owner prefers otherwise.

### Phase 2 — rehearsal (no downtime) — Op

8. `mirqam-points-fra` → Shell:
   ```sh
   cd /app && node apps/api/src/db/copy-cli.js
   ```
   Must end with `ALL TABLES COPIED AND VERIFIED`. It reads a consistent snapshot while Oregon keeps serving. Note how long it took (sets the freeze length). A rerun needs `--replace`.
   Failure modes: `migrations differ` → `mirqam-points` is not on the merged commit (redo step 3); connection timeout → step 6; `SOURCE_DATABASE_URL ... required` → step 5.
9. Optional: `node apps/api/src/db/copy-cli.js --verify` — a few `FAIL` lines are normal here (Oregon took writes since step 8).

### Phase 3 — cutover (write freeze ≈ 5–10 min; reads keep working) — Op

Pick a quiet hour (e.g. 03:00 Riyadh = 00:00 UTC). For each env change use **Save and deploy** (no rebuild) and wait for *Deploy live*.

10. **Freeze Oregon.** `mirqam-points` → Environment → add `MIRQAM_READ_ONLY` = `1` → Save and deploy. Checks:
    - `curl -s $ORE/api/health` → contains `"readOnly":true`
    - `curl -s -X POST -H 'content-type: application/json' $ORE/api/auth/login -d '{}'` → `{"error":"maintenance"}`
    - then wait 60 s so the previous instance has drained. **Writes are frozen from here.**
11. **Final copy.** `mirqam-points-fra` → Shell:
    ```sh
    cd /app && node apps/api/src/db/copy-cli.js --replace && node apps/api/src/db/copy-cli.js --verify
    ```
    Must print `ALL TABLES COPIED AND VERIFIED` then `SOURCE AND TARGET MATCH`. If not: do not continue — rollback A.
12. **Frankfurt live.** `mirqam-points-fra` → Environment → `MIRQAM_LIVE` = `1` → Save and deploy. Checks: `curl -s $FRA/api/health` → `{"ok":true,"version":...,"db":"postgres"}` (no `standby`, no `readOnly`); logs show `[api] listening ... (db: postgres, production)` and no `[db] applied` line.
13. **Oregon forwards.** `mirqam-points` → Environment → add `FORWARD_TO` = `https://mirqam-points-fra.onrender.com` → Save and deploy (leave `MIRQAM_READ_ONLY`; `FORWARD_TO` wins). **The freeze ends when this deploy is live.** Checks:
    - `curl -si $ORE/api/health` → header `x-mirqam-forwarder: 1`, body without `readOnly`
    - `curl -si https://loyalty.mirqam.sa/api/health` → same
    - `curl -s $ORE/__forwarder/health` → `{"ok":true,"forwarding":"https://mirqam-points-fra.onrender.com"}`
    - live updates: `curl -s -X POST -H 'content-type: application/json' $ORE/api/mobile/live-update -d '{"app_id":"sa.mirqam.points","version_build":"1.1.0","version_name":"builtin"}'` → a `version` and a `url`
    - `mirqam-points` logs: `[launch] forwarding every request ...`; `mirqam-points-fra` logs show the requests and, within the hour, its own `[billing]` / `[deletion]` job lines (none on Oregon).
    - functional: sign in on https://loyalty.mirqam.sa, record a test earn on a test workspace, open the Points Business app (iOS + Android) and do the same; the workspace's data is complete.

### Phase 4 — move the domain (≤ a few minutes of TLS/404 on `loyalty.mirqam.sa` only; app traffic via onrender unaffected)

Right after phase 3, or the next quiet hour.

14. **Owner** (sahara.com.sa DNS): change `loyalty` CNAME → `mirqam-points-fra.onrender.com`. Optional but recommended: add `points` CNAME → `mirqam-points-fra.onrender.com` too — wallet passes and links issued with `points.mirqam.sa` start working. While the domain is still attached to `mirqam-points`, Render keeps routing it there (forwarder → Frankfurt), so do step 15 immediately after.
15. **Op:** `mirqam-points` → Settings → Custom Domains → delete `loyalty.mirqam.sa` and `points.mirqam.sa`. `mirqam-points-fra` → Settings → Custom Domains → add `loyalty.mirqam.sa` (and `points.mirqam.sa` if step 14 added it) → Verify → wait for the certificate.
    Check: `curl -si https://loyalty.mirqam.sa/api/health` → 200 **without** `x-mirqam-forwarder` (direct to Frankfurt); the HQ entry on https://loyalty.mirqam.sa still works.
16. **Op:** commit to render.yaml (then sync; it must show no other change): in `mirqam-points` remove its `domains:` block, and in `mirqam-points-fra` replace the "No custom domain yet" comment with
    ```yaml
        domains:
          - loyalty.mirqam.sa
          - points.mirqam.sa   # only if the Owner added the points CNAME
    ```
    Also update README.md's DNS line to `loyalty CNAME mirqam-points-fra.onrender.com`.

### Phase 5 — cleanup (after 7 stable days)

17. **Owner:** delete `SOURCE_DATABASE_URL` from `mirqam-points-fra`. **Op:** remove the Frankfurt ranges from `mirqam-points-db` Access Control (back to empty).
18. Keep `mirqam-points` running as the forwarder (starter; a free instance would sleep and make update checks slow) until every installed app runs a store build whose native update URL is `loyalty.mirqam.sa` (the next store release carries it). Then it can be deleted.
19. `mirqam-points-db`: export a final backup (dashboard → Recovery/Export), then remove the `DATABASE_URL` link and the `mirqam-points-db` block from render.yaml and delete the database (the forwarder never uses it).

### Rollback

**A. Before step 12** (Frankfurt never went live): `mirqam-points` → delete `MIRQAM_READ_ONLY` → Save and deploy. Nothing was written anywhere else.

**B. After step 12/13** — never let both regions write at once, so in this order:
1. `mirqam-points` → set `MIRQAM_READ_ONLY=1`, delete `FORWARD_TO` → Save and deploy (Oregon serves reads from its own data, refuses writes).
2. `mirqam-points-fra` → delete `MIRQAM_LIVE` → Save and deploy (back to standby; its jobs stop).
3. If phase 4 was done: Owner points `loyalty` (and `points`) CNAME back at `mirqam-points.onrender.com`; Op moves the custom domains back to `mirqam-points`.
4. `mirqam-points` → delete `MIRQAM_READ_ONLY` → Save and deploy.

Oregon's data is as of step 10: writes made in Frankfurt after the cutover are **not** carried back. If they matter, before B.4 run the same tool in reverse from the `mirqam-points` Shell (`SOURCE_DATABASE_URL` = Frankfurt external URL, pasted by the Owner; requires adding Oregon's outbound ranges to `mirqam-points-db-fra` Access Control): `node apps/api/src/db/copy-cli.js --replace` (it targets `mirqam-points`' own `DATABASE_URL`).

### Notes

- Webhooks during the freeze get `503` with `Retry-After`. Senders that retry (Moyasar, Apple Wallet devices) recover by themselves; check mirqam-billing's logs for `/api/billing/hooks` deliveries refused during the window and re-send any it did not retry.
- If `SECRET_KEY` differed between the services, forwarded requests still work but all share Oregon's address for rate limiting (login limit `AUTH_RATE_LIMIT` per minute) and are not recognised as same-origin for browser writes on `mirqam-points.onrender.com` — fix the key rather than raising limits.
- Deploys of either service are manual (`autoDeployTrigger: off`); after the move deploy `mirqam-points-fra` for releases and `mirqam-points` only when the forwarder code changes.
