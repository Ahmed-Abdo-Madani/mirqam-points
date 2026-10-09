#!/usr/bin/env node
/* Points git at the tracked .githooks/ folder (git does not version .git/hooks).
   Run once per clone: npm run hooks:install */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const git = (args) =>
  execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim()

try {
  git(['rev-parse', '--is-inside-work-tree'])
} catch {
  console.error('[hooks] not inside a git working tree.')
  process.exit(1)
}
if (!existsSync(join(root, '.githooks', 'pre-push'))) {
  console.error('[hooks] .githooks/pre-push is missing.')
  process.exit(1)
}
git(['config', 'core.hooksPath', '.githooks'])
console.log(`[hooks] core.hooksPath=${git(['config', '--get', 'core.hooksPath'])} — pre-push now runs scripts/verify.mjs`)
