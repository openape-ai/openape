#!/usr/bin/env node

/**
 * Local release orchestrator.
 *
 *   pnpm release:local
 *
 * Why this exists
 * ---------------
 * The default `changesets/action@v1` flow needs four sequential CI cycles for
 * one publish (feature PR, post-merge main CI, version-PR, post-merge main CI
 * again). For a small monorepo that's many minutes of waiting per patch and
 * extra surface for flakes. This script runs the same steps locally, in one
 * pass:
 *
 *   1. preflight         (clean tree, on main, in sync, npm logged in)
 *   2. changeset version (consume `.changeset/*.md`, bump versions, write CHANGELOGs)
 *   3. commit            ("chore: version packages")
 *   4. build             (publishable packages only — same filter CI uses)
 *   5. publish-chain     (publish whatever's not yet on npm, in dep order)
 *   6. push              (so origin/main reflects the new versions)
 *
 * The CI-side `release.yml` is the safety net: if a contributor forgets to
 * run this and pushes raw changesets to main, the workflow fails loudly
 * instead of silently opening a version-PR. Versioning is local-only.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function run(cmd, args, opts = {}) {
  console.log(`${DIM}$ ${cmd} ${args.join(' ')}${RESET}`)
  return execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts })
}

function capture(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf-8', cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim()
}

function fail(msg) {
  console.error(`\n${RED}✗ ${msg}${RESET}\n`)
  process.exit(1)
}

function step(label) {
  console.log(`\n${CYAN}▶ ${label}${RESET}`)
}

// --- 1. Preflight -----------------------------------------------------------

step('Preflight')

const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') fail(`Must be on main, currently on '${branch}'.`)

const dirty = capture('git', ['status', '--porcelain'])
if (dirty) fail(`Working tree not clean:\n${dirty}\n\nCommit or stash first.`)

run('git', ['fetch', 'origin', 'main'])
const behind = Number(capture('git', ['rev-list', '--count', 'HEAD..origin/main']))
if (behind > 0) fail(`Local main is ${behind} commit(s) behind origin/main. Pull first.`)

const ahead = Number(capture('git', ['rev-list', '--count', 'origin/main..HEAD']))
if (ahead > 0) {
  console.log(`${DIM}  ${ahead} local commit(s) ahead of origin/main — will be pushed after publish.${RESET}`)
}

try {
  const who = capture('npm', ['whoami'])
  console.log(`${DIM}  npm whoami: ${who}${RESET}`)
}
catch {
  fail('npm whoami failed — run `npm login` first or set NPM_TOKEN in your shell.')
}

// --- 2. Detect pending changesets ------------------------------------------

step('Detect pending changesets')

const csDir = resolve(ROOT, '.changeset')
const csFiles = readdirSync(csDir).filter(f => f.endsWith('.md') && f !== 'README.md')
console.log(`${DIM}  found ${csFiles.length} pending changeset file(s)${RESET}`)

if (csFiles.length > 0) {
  step('changeset version')
  run('pnpm', ['changeset', 'version'])

  const newDirty = capture('git', ['status', '--porcelain'])
  if (newDirty) {
    step('Commit version bump')
    run('git', ['add', '-A'])
    run('git', ['commit', '-m', 'chore: version packages'])
  }
  else {
    // All changesets target ignored packages → nothing to commit. publish-chain
    // will still detect drift if any local version > npm.
    console.log(`${DIM}  changeset version produced no changes (ignored packages?) — skipping commit.${RESET}`)
  }
}

// --- 3. Build publishable packages -----------------------------------------

step('Build publishable packages')
run('pnpm', ['turbo', 'run', 'build', '--filter=./packages/*', '--filter=./modules/*'])

// --- 4. Publish ------------------------------------------------------------

step('Publish (only packages where local > npm)')
run('node', ['scripts/publish-chain.mjs'])

// --- 5. Push ---------------------------------------------------------------

step('Push to origin/main')
run('git', ['push', 'origin', 'main'])

console.log(`\n${GREEN}✅ Release complete.${RESET}\n`)
