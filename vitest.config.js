import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/api/src/**/*.test.js', 'apps/web/src/**/*.test.js', 'packages/*/src/**/*.test.js'],
    environment: 'node',
    // PGlite boots a WASM Postgres per suite; give cold starts room. Under full parallel load the
    // POS bridge/loyalty suites take ~25-30s on a laptop (about 8s alone), so 20s was flaky.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
