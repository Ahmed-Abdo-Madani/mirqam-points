# Moving Mirqam Points from Oregon to Frankfurt

Short runbook. The detailed version, with every check and the rollback, is
[RUNBOOK.md, "Move to Frankfurt"](./RUNBOOK.md#move-to-frankfurt-oregon--frankfurt-2026-11).
Nothing here is automated: every step is an operator action in the Render
dashboard, the DNS panel or a service shell. Before step 1, both services must
run the same commit (the copy refuses databases at different migrations), and
`mirqam-points-fra` must have every secret of `mirqam-points` (RUNBOOK.md,
phase 1: `SECRET_KEY` byte-identical, `MIRQAM_POS_BRIDGE_KEY`,
`MIRQAM_COMMERCE_KEY`, billing, wallet and email keys).

| | Old (Oregon) | New (Frankfurt) |
|---|---|---|
| Web service | `mirqam-points` | `mirqam-points-fra` |
| Database | `mirqam-points-db` | `mirqam-points-db-fra` |
| Domain | `loyalty.mirqam.sa` until step 5 | from step 5 |

## Safety guard (in the code)

`mirqam-points-fra` is declared with `MIRQAM_REQUIRE_LIVE=1`, so it stays in
standby (health checks only) until `MIRQAM_LIVE=1`. Setting `MIRQAM_LIVE=1`
before the data is there is refused as well: on a `MIRQAM_REQUIRE_LIVE`
service the app starts only if its database holds loyalty data (a workspace
or a ledger entry). Otherwise it logs

```
[launch] MIRQAM_LIVE=1 refused: the database has no loyalty data ...
```

stays in standby, and `/api/health` answers
`{"ok":true,"standby":true,...,"reason":"empty_database"}`. The check only
reads, before any migration, so a refused start changes nothing.
`MIRQAM_MIGRATION_COMPLETE=1` overrides it for a database that is meant to
start empty; never set it for this move. The Oregon service has no
`MIRQAM_REQUIRE_LIVE` and never runs the check (`apps/api/src/launch-guard.js`).

## Steps

Pick a quiet hour (for example 03:00 Riyadh). Writes are frozen from step 1
until the forwarder is live in step 4, usually 5 to 10 minutes; reads keep
working throughout.

1. **Freeze writes on Oregon.** `mirqam-points` → Environment →
   `MIRQAM_READ_ONLY=1` → Save and deploy. Check that
   `curl -s https://mirqam-points.onrender.com/api/health` contains
   `"readOnly":true`, then wait 60 s for the old instance to drain.

2. **Copy the database.** `mirqam-points-fra` must not have `MIRQAM_LIVE` yet:
   the copy tool refuses to write into a live service's database.
   - Built in (recommended): `mirqam-points-fra` → Shell →
     `cd /app && node apps/api/src/db/copy-cli.js --replace`. It reads Oregon
     through `SOURCE_DATABASE_URL`, writes in one transaction, checks every
     table before committing and ends with `ALL TABLES COPIED AND VERIFIED`.
     Oregon's database must allow the Frankfurt service's outbound IP ranges
     (Access Control; RUNBOOK.md step 6).
   - Or with the Postgres 16 tools, from a machine whose IP both databases
     allow (their Access Control lists are empty today, which blocks every
     outside connection; add the entry for the move and remove it afterwards).
     Keep both **external** URLs in environment variables, never in a command
     line, a chat or a log:
     ```sh
     pg_dump --format=custom --no-owner --no-privileges "$SOURCE_DATABASE_URL" > points.dump
     pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$TARGET_DATABASE_URL" points.dump
     ```
     Delete `points.dump` afterwards: it holds customer phone numbers.

3. **Verify row counts and balances.** Whichever way the data was copied:
   `mirqam-points-fra` → Shell →
   `cd /app && node apps/api/src/db/copy-cli.js --verify`. It reads both
   databases in one read-only snapshot each and prints:
   - one `OK` line per table with the row count on each side (content is
     compared by checksum, so balances are compared exactly);
   - two `totals source:` / `totals target:` lines: row counts, balances per
     program type (points and stamps are separate units), gift-card balances in
     halalas, and `accounts off ledger` (cached balances that differ from the
     ledger). Everything after the side name must be identical;
     `accounts off ledger` should be 0 (if not, note the number for the owner:
     it is then the same in Oregon, not a copy error);
   - last line `SOURCE AND TARGET MATCH`.

   Anything else: stop and roll back (RUNBOOK.md, rollback A: delete
   `MIRQAM_READ_ONLY` on Oregon). Nothing was written anywhere else.

4. **Go live in Frankfurt, then forward Oregon.**
   - `mirqam-points-fra` → `MIRQAM_LIVE=1` → Save and deploy. Check that
     `curl -s https://mirqam-points-fra.onrender.com/api/health` has no
     `standby`. If it shows `"reason":"empty_database"`, the data is not there:
     delete `MIRQAM_LIVE` again, redo steps 2 and 3, then retry.
   - `mirqam-points` → `FORWARD_TO=https://mirqam-points-fra.onrender.com` →
     Save and deploy. Writes resume here: everything still calling
     `mirqam-points.onrender.com` or the domain reaches Frankfurt through
     Oregon. Check `curl -si https://loyalty.mirqam.sa/api/health` shows the
     `x-mirqam-forwarder: 1` header.

5. **Switch the domain.** DNS: `loyalty` CNAME →
   `mirqam-points-fra.onrender.com` (and `points`, if the owner adds it).
   Then move the custom domains from `mirqam-points` to `mirqam-points-fra` in
   Render and wait for the certificate. Check that
   `curl -si https://loyalty.mirqam.sa/api/health` answers 200 **without**
   `x-mirqam-forwarder` (direct to Frankfurt).

6. **Switch the POS integration.** The POS calls Points on
   `https://loyalty.mirqam.sa` (for example `POST /api/pos/loyalty/status`),
   so step 5 moves it. If the POS service is configured with
   `mirqam-points.onrender.com` instead, it keeps working through the
   forwarder; change it to `https://loyalty.mirqam.sa` so it stops depending on
   Oregon. `MIRQAM_POS_BRIDGE_KEY` and `MIRQAM_COMMERCE_KEY` must be identical
   on both services. Check from the POS: look up a member and record a test
   sale on a test workspace; the sale appears in the Frankfurt logs.

7. **Suspend the old stack**, after 7 stable days:
   - keep `mirqam-points` running as the forwarder until every installed app
     runs a store build that calls `loyalty.mirqam.sa` (older builds fetch
     live updates from `mirqam-points.onrender.com`), then suspend it;
   - export a final backup of `mirqam-points-db`, then suspend or delete it;
   - remove `SOURCE_DATABASE_URL` from `mirqam-points-fra` and every
     temporary Access Control entry from both databases.

## Never

- Never let both regions accept writes: Oregon stays read-only or forwarding
  from step 1 on.
- Never set `MIRQAM_MIGRATION_COMPLETE=1` to get past the guard during this move.
- Never paste a database URL into a chat, a ticket or a log.
