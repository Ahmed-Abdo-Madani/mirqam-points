# AGENTS.md

Guidance for coding agents (and humans) working in Mirqam Points. Read
[PLAN.md](./PLAN.md) for product scope and phases.

## Validation rule (mandatory)

**Every edit is followed by the gate, and nothing is "done" until it passes:**

```powershell
node scripts/verify.mjs; echo "exit code: $LASTEXITCODE"
```

`verify.mjs` is self-contained and mirrors CI:

1. Unit tests (vitest): ledger invariants, earn rules, phone normalization, i18n completeness.
2. Boots the API on a free port with an in-memory Postgres (PGlite), runs the
   HTTP battery (`tests/http/run.mjs`), tears it down, and fails if the server
   logged any unhandled error.
3. Builds the web console.

Inspect the **exit code** (0 = pass) and quote the summary in your final
response. `--skip-build` exists for tight API loops; the final run must be full.
CI additionally runs the gate against real Postgres 16 and `biome check`.

The pre-push hook runs the same gate: `npm run hooks:install` once per clone.

## Non-negotiable invariants

- **The ledger is append-only.** Never UPDATE/DELETE `ledger_entries` (a
  trigger blocks it). Corrections are new `adjust` / `void` entries via
  `apps/api/src/ledger.js` — never write balances directly. The one exception
  is the purge of a *closed* workspace after its owner deleted the account
  (`apps/api/src/account-deletion.js`); a new table with a `tenant_id` must be
  added to its purge list (the account-deletion test enforces this).
- **Every ledger mutation carries an idempotency key** (`Idempotency-Key`
  header). Clients mint one per distinct request with `useIdempotencyKey`
  and reuse it on retry.
- **Money is integer halalas; points/stamps are integers.** No floats.
  Points and stamps are different units — never sum them together.
- **Tenant isolation lives in the schema** (composite `(id, tenant_id)` FKs) *and*
  every query filters by `req.auth.tenantId`. New tables follow the same pattern;
  add an isolation case to the HTTP battery.
- **Points are computed server-side** from the purchase amount. Cashiers never
  type points to earn.
- **Migrations are forward-only**: add `apps/api/migrations/NNN-name.sql`; never
  edit a shipped file.

## Design language

All UI comes from `@mirqam/ui` (`packages/ui`) — the Mirqam unified design
language shared with bot.mirqam.sa. Use semantic tokens (`bg-surface`,
`text-ink`, `text-muted`, `border-line`, `bg-primary`, `text-accent`), not raw
colours. Primary actions are navy; teal is for focus/active/links. Western
digits with `.tnum`. Review `/design` in light/dark and AR/EN after UI changes.

## Copy & i18n

Arabic first. No hardcoded UI strings: add keys to both
`apps/web/src/i18n/ar.js` and `en.js` (the i18n test fails otherwise, including
for any new API error code without copy). `/design` is the only exemption.

## Layout

```
apps/api        Express 5 API (+ serves the built SPA in production)
apps/web        React 18 + Vite 7 + Tailwind 4 console
packages/ui     @mirqam/ui — tokens, primitives, icons, brand components
packages/shared Pure logic shared by API and web (phone, earn rules, money)
tests/http      HTTP battery used by the gate
scripts         verify, seed-dev, install-hooks
```
