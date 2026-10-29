#!/usr/bin/env bash
# Mirqam Loyalty demo container start (demo branch only): a private Postgres inside
# this container, freshly seeded Arabic sample data on every start, then the app.
# Nothing here talks to production: no external database, no payment / email /
# wallet keys, and the seed refuses any non-loopback DATABASE_URL.
set -euo pipefail
export MIRQAM_DEMO=1
cd "$(dirname "$0")/.."

# --- private Postgres (Debian postgresql package; runs as the postgres user) ---
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
export PGDATA=${DEMO_PGDATA:-/tmp/demo-pg}
PGPORT=${DEMO_PGPORT:-5432}
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"; chown postgres:postgres "$PGDATA"; chmod 700 "$PGDATA"
  su postgres -s /bin/bash -c "$PGBIN/initdb -D '$PGDATA' -A trust -U postgres --encoding=UTF8 --locale=C.UTF-8" >/dev/null
fi
su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D '$PGDATA' status" >/dev/null 2>&1 || \
su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D '$PGDATA' -l ${DEMO_PGLOG:-/tmp/demo-pg.log} -w start -o \"-c listen_addresses=127.0.0.1 -c port=$PGPORT -c unix_socket_directories=/tmp -c shared_buffers=32MB -c max_connections=60 -c fsync=off -c synchronous_commit=off -c full_page_writes=off\"" >/dev/null
su postgres -s /bin/bash -c "$PGBIN/psql -h 127.0.0.1 -p $PGPORT -U postgres -tAc \"SELECT 1 FROM pg_database WHERE datname='demo'\"" | grep -q 1 \
  || su postgres -s /bin/bash -c "$PGBIN/createdb -h 127.0.0.1 -p $PGPORT -U postgres demo"
export DATABASE_URL="postgres://postgres@127.0.0.1:$PGPORT/demo"

# --- app settings (production mode, demo data) ---
export NODE_ENV=${NODE_ENV:-production}
export PORT=${PORT:-10000}
export PUBLIC_URL=${PUBLIC_URL:-${RENDER_EXTERNAL_URL:-http://localhost:$PORT}}
export TRUST_PROXY=${TRUST_PROXY:-1}
export PG_POOL_MAX=${PG_POOL_MAX:-8}
# Third-party integrations stay off: never pass payment, email, wallet, POS or OAuth keys to the demo.
unset MOYASAR_SECRET_KEY MOYASAR_WEBHOOK_SECRET BILLING_URL BILLING_API_KEY BILLING_WEBHOOK_SECRET RESEND_API_KEY \
  MIRQAM_COMMERCE_KEY MIRQAM_POS_BRIDGE_KEY GOOGLE_WALLET_ISSUER_ID GOOGLE_WALLET_SA_JSON APPLE_PASS_TYPE_ID APPLE_TEAM_ID \
  APPLE_PASS_CERT_PEM APPLE_PASS_KEY_PEM APPLE_PASS_KEY_PASSPHRASE APPLE_WWDR_PEM SOCIAL_LOGIN_ENABLED \
  SOCIAL_GOOGLE_CLIENT_ID SOCIAL_GOOGLE_CLIENT_SECRET SOCIAL_GITHUB_CLIENT_ID SOCIAL_GITHUB_CLIENT_SECRET BILLING_ENFORCE

# --- demo-only secrets, generated per start when not provided ---
rand() { node -e "console.log(require('crypto').randomBytes(${1:-32}).toString('hex'))"; }
export SECRET_KEY=${SECRET_KEY:-$(rand 32)}

# --- schema + sample data ---
node apps/api/src/db/migrate-cli.js
node demo/seed.mjs

# --- the app (PID 1) ---
exec node apps/api/src/server.js
