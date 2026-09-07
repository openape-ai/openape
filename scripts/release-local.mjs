#!/usr/bin/env node

/**
 * Publish versions already merged into the canonical main branch.
 * Prepare version changes with pnpm version-packages on a feature branch,
 * merge that PR, then run this from a clean, up-to-date main checkout.
 * --dry-run validates the repository/commit without publishing or changing git.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { gitRemotes, repository, resolveTruthRemote } from './repository.mjs'

const ROOT = new URL('..', import.meta.url).pathname

const RED = '\x1B[31m'
const GREEN = '\x1B[32m'
const CYAN = '\x1B[36m'
const DIM = '\x1B[2m'
const RESET = '\x1B[0m'

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
if (branch !== repository.defaultBranch) fail(`Must be on ${repository.defaultBranch}, currently on '${branch}'.`)

const dirty = capture('git', ['status', '--porcelain'])
if (dirty) fail(`Working tree not clean:\n${dirty}\n\nCommit or stash first.`)

const remote = resolveTruthRemote(gitRemotes(ROOT))
run('git', ['fetch', remote, repository.defaultBranch])
const base = `${remote}/${repository.defaultBranch}`
const head = capture('git', ['rev-parse', 'HEAD'])
if (head !== capture('git', ['rev-parse', base])) fail(`HEAD must equal ${base}. Merge the version PR and update this checkout first.`)

const csFiles = readdirSync(resolve(ROOT, '.changeset')).filter(f => f.endsWith('.md') && f !== 'README.md')
if (csFiles.length > 0) fail('Pending changesets: run pnpm version-packages on a feature branch, then merge the version PR before publishing.')

console.log(JSON.stringify({ repository: repository.url, remote, branch, sha: head, dryRun: process.argv.includes('--dry-run') }))
if (process.argv.includes('--dry-run')) process.exit(0)
try {
  console.log(`npm identity: ${capture('npm', ['whoami'])}`)
}
catch {
  fail('npm whoami failed — run npm login first.')
}

// --- 3. Build publishable packages -----------------------------------------

step('Build publishable packages')
run('pnpm', ['turbo', 'run', 'build', '--filter=./packages/*', '--filter=./modules/*'])

// --- 4. Publish ------------------------------------------------------------

step('Publish (only packages where local > npm)')
run('node', ['scripts/publish-chain.mjs'])

console.log(`\n${GREEN}Release complete from ${head}.${RESET}\n`)
