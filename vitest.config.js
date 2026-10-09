import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/api/src/**/*.test.js', 'apps/web/src/**/*.test.js', 'packages/*/src/**/*.test.js'],
    environment: 'node',
    // PGlite boots a WASM Postgres per suite; give cold starts room.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
