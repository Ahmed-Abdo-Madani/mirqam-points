# Moving Mirqam Points from Oregon to Frankfurt

Short runbook. The detailed, step-by-step version with every check and the
rollback is [RUNBOOK.md, "Move to Frankfurt"](./RUNBOOK.md#move-to-frankfurt-oregon--frankfurt-2026-11).
Nothing here is automated: every step is an operator action in the Render
dashboard, the DNS panel or a service shell.

| | Old (Oregon) | New (Frankfurt) |
|---|---|---|
| Web service | `mirqam-points` | `mirqam-points-fra` |
| Database | `mirqam-points-db` | `mirqam-points-db-fra` |
| Domain today | `loyalty.mirqam.sa` | none until step 5 |

## Safety guard (in the code)

`mirqam-points-fra` is declared with `MIRQAM_REQUIRE_LIVE=1`, so it stays in
standby (health checks only) until `MIRQAM_LIVE=1`. Setting `MIRQAM_LIVE=1`
before the data is copied is refused too: on a `MIRQAM_REQUIRE_LIVE` service
the app starts only if its database already holds loyalty data (a workspace
or a ledger entry). Otherwise it logs

```
[launch] MIRQAM_LIVE=1 refused: the database has no loyalty data ...
```

stays in standby, and `/api/health` answers `{"ok":true,"standby":true,"reason":"empty_database",...}`.
The check only reads and runs before migrations, so a refused start changes
nothing in the database. `MIRQAM_MIGRATION_COMPLETE=1` overrides it, for a
database that is meant to start empty; do **not** set it for this move.
Services without `MIRQAM_REQUIRE_LIVE` (the Oregon service) never run the
check (`apps/api/src/launch-guard.js`).

## Steps

Pick a quiet hour (for example 03:00 Riyadh). Writes stop for about 5 to 10
minutes in step 1 to step 4; reads keep working.

1. **Freeze writes on Oregon.** `mirqam-points` → Environment →
   `MIRQAM_READ_ONLY=1` → Save and deploy. Check:
   `curl -s https://mirqam-points.onrender.com/api/health` contains
   `"readOnly":true`. Wait 60 s for the old instance to drain.

2. **Copy the database.** `mirqam-points-fra` must have no `MIRQAM_LIVE`
   at this point (the copy tool refuses a live target).
   - Built in (recommended; verifies every table by row count and checksum
     inside one transaction): `mirqam-points-fra` → Shell →
     `cd /app && node apps/api/src/db/copy-cli.js --replace && node apps/api/src/db/copy-cli.js --verify`.
     It must print `ALL TABLES COPIED AND VERIFIED` then `SOURCE AND TARGET MATCH`.
   - Or with the Postgres tools (same major version, 16), from any machine
     allowed by both databases' access control, with the two **external**
     URLs in environment variables (never typed into a command or a log):
     ```sh
     pg_dump --format=custom --no-owner --no-privileges "$SOURCE_DATABASE_URL" > points.dump
     pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$TARGET_DATABASE_URL" points.dump
     ```
     Delete `points.dump` afterwards: it holds customer phone numbers.

3. **Verify row counts and balances.** Run on **both** databases (Render →
   database → Connect → PSQL, read only) and compare; every line must match.
   ```sql
   SELECT (SELECT count(*) FROM tenants)            AS tenants,
          (SELECT count(*) FROM members)            AS members,
          (SELECT count(*) FROM accounts)           AS accounts,
          (SELECT count(*) FROM ledger_entries)     AS ledger_entries,
          (SELECT count(*) FROM gift_cards)         AS gift_cards,
          (SELECT count(*) FROM gift_card_entries)  AS gift_card_entries,
          (SELECT count(*) FROM schema_migrations)  AS migrations;

   -- Points and stamps are separate units: compare per program type, never summed.
   SELECT p.type, sum(a.balance) AS balance, sum(a.lifetime_earned) AS lifetime_earned
     FROM accounts a JOIN programs p ON p.id = a.program_id GROUP BY p.type ORDER BY p.type;

   SELECT sum(balance_minor) AS gift_card_balance_halalas FROM gift_cards;

   -- Cached balances must equal the ledger: expect 0 rows on both.
   SELECT a.id FROM accounts a
     LEFT JOIN ledger_entries l ON l.account_id = a.id
    GROUP BY a.id, a.balance HAVING a.balance <> coalesce(sum(l.amount), 0);
   ```
   Any difference: stop and roll back (RUNBOOK.md, rollback A: delete
   `MIRQAM_READ_ONLY` on Oregon).

4. **Go live in Frankfurt, forward Oregon.**
   - `mirqam-points-fra` → `MIRQAM_LIVE=1` → Save and deploy. Check
     `curl -s https://mirqam-points-fra.onrender.com/api/health` has no
     `standby`. If it shows `"reason":"empty_database"`, the copy did not land:
     go back to step 2.
   - `mirqam-points` → `FORWARD_TO=https://mirqam-points-fra.onrender.com` →
     Save and deploy. Writes resume here: installed apps and anything still
     calling `mirqam-points.onrender.com` reach Frankfurt through Oregon.

5. **Switch the domain.** DNS: `loyalty` CNAME → `mirqam-points-fra.onrender.com`.
   Then move the custom domain(s) from `mirqam-points` to `mirqam-points-fra`
   in Render and wait for the certificate. Check
   `curl -si https://loyalty.mirqam.sa/api/health` answers 200 **without** the
   `x-mirqam-forwarder` header.

6. **Switch the POS integration.** The POS calls Points (for example
   `POST /api/pos/loyalty/status`). If its configured Points address is
   `https://loyalty.mirqam.sa`, step 5 already moved it; if it is
   `https://mirqam-points.onrender.com`, change it to
   `https://loyalty.mirqam.sa` in the POS service. `MIRQAM_POS_BRIDGE_KEY` must
   be identical on both sides. Check from the POS: look up a known member and
   record a test sale on a test workspace.

7. **Suspend the old stack** only after 7 stable days:
   - keep `mirqam-points` running as the forwarder until every installed app
     runs a store build that calls `loyalty.mirqam.sa` (older builds hardcode
     `mirqam-points.onrender.com` for live updates), then suspend it;
   - export a final backup of `mirqam-points-db`, then suspend or delete it;
   - remove `SOURCE_DATABASE_URL` from `mirqam-points-fra` and the temporary
     access-control entries from both databases.

## Never

- Never let both regions accept writes at the same time: Oregon stays
  read-only or forwarding from step 1 on.
- Never set `MIRQAM_MIGRATION_COMPLETE=1` to get past the guard during this move.
- Never paste a database URL into a chat, a ticket or a log.
