#!/usr/bin/env node

/**
 * Local deploy orchestrator — replaces the per-app GitHub deploy workflows
 * (deploy-{org,troop,chat,docs,free-idp}.yml). Deploys run from the
 * maintainer's machine now: each target's scripts/deploy-<t>.sh already
 * builds locally, rsyncs to chatty, swaps the `current` symlink, restarts
 * the systemd service and health-checks. This wrapper adds the two things
 * that previously lived only in the workflow YAML:
 *
 *   1. target selection from changed paths (the workflow `paths:` filters)
 *   2. capture-previous-release + rollback when the deploy script fails
 *
 * Usage:
 *   pnpm deploy <target...>      # deploy named targets (e.g. troop org)
 *   pnpm deploy --all            # deploy every target
 *   pnpm deploy --changed[=ref]  # deploy targets whose paths changed vs ref
 *                                #   (ref defaults to origin/main)
 *   pnpm deploy --dry-run ...    # print the plan; touch nothing
 *   pnpm deploy --list           # list known targets and exit
 *
 * SSH: capture/rollback connect as ${CHATTY_USER:-openape}@${CHATTY_HOST:-chatty.delta-mind.at}.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPTS_DIR, '..')
const SSH_USER = process.env.CHATTY_USER || 'openape'
const SSH_HOST = process.env.CHATTY_HOST || 'chatty.delta-mind.at'

// One entry per app. `paths` mirrors the `on.push.paths` filter of the
// retired deploy-<name>.yml. `service`/`base` are read from the matching
// scripts/deploy-<name>.sh — keep them in sync if those scripts move.
// `service: null` = static deploy (docs): symlink swap only, no restart,
// so there is nothing to roll back to.
const TARGETS = {
  org: {
    script: 'deploy-org.sh',
    base: '/home/openape/projects/openape-org',
    service: 'openape-org.service',
    paths: ['apps/openape-org/**', 'modules/nuxt-auth-sp/**', 'packages/auth/**', 'packages/core/**', 'scripts/deploy-org.sh', 'pnpm-lock.yaml'],
  },
  troop: {
    script: 'deploy-troop.sh',
    base: '/home/openape/projects/openape-troop',
    service: 'openape-troop.service',
    paths: ['apps/openape-troop/**', 'modules/nuxt-auth-sp/**', 'packages/auth/**', 'packages/core/**', 'scripts/deploy-troop.sh', 'pnpm-lock.yaml'],
  },
  chat: {
    script: 'deploy-chat.sh',
    base: '/home/openape/projects/openape-chat',
    service: 'openape-chat.service',
    paths: ['apps/openape-chat/**', 'modules/nuxt-auth-sp/**', 'packages/auth/**', 'packages/core/**', 'scripts/deploy-chat.sh', 'pnpm-lock.yaml'],
  },
  'free-idp': {
    script: 'deploy-free-idp.sh',
    base: '/home/openape/projects/openape-free-idp',
    service: 'openape-free-idp.service',
    paths: ['apps/openape-free-idp/**', 'modules/nuxt-auth-idp/**', 'packages/auth/**', 'packages/core/**', 'packages/grants/**', 'scripts/deploy-free-idp.sh', 'pnpm-lock.yaml'],
  },
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

if (args.includes('--list')) {
  console.log('Targets:')
  for (const name of Object.keys(TARGETS)) console.log(`  ${name}`)
  process.exit(0)
}

// Our path patterns are either `dir/**` (prefix match) or an exact file.
function fileMatches(file, pattern) {
  if (pattern.endsWith('/**')) return file.startsWith(pattern.slice(0, -2))
  return file === pattern
}

function changedFiles(ref) {
  const out = execFileSync('git', ['diff', '--name-only', `${ref}...HEAD`], { cwd: ROOT, encoding: 'utf-8' })
  return out.split('\n').map(s => s.trim()).filter(Boolean)
}

function ssh(remoteCmd) {
  return execFileSync('ssh', ['-l', SSH_USER, SSH_HOST, remoteCmd], { encoding: 'utf-8' }).trim()
}

// --- Select targets ---

let selected = []
const changedArg = args.find(a => a === '--changed' || a.startsWith('--changed='))

if (args.includes('--all')) {
  selected = Object.keys(TARGETS)
} else if (changedArg) {
  const ref = changedArg.includes('=') ? changedArg.split('=')[1] : 'origin/main'
  const files = changedFiles(ref)
  console.log(`Changed vs ${ref}: ${files.length} file(s)`)
  selected = Object.keys(TARGETS).filter(name => files.some(f => TARGETS[name].paths.some(p => fileMatches(f, p))))
} else {
  const named = args.filter(a => !a.startsWith('--'))
  const unknown = named.filter(n => !TARGETS[n])
  if (unknown.length) {
    console.error(`Unknown target(s): ${unknown.join(', ')}`)
    console.error(`Known: ${Object.keys(TARGETS).join(', ')}`)
    process.exit(2)
  }
  selected = named
}

if (selected.length === 0) {
  console.log('Nothing to deploy.')
  process.exit(0)
}

console.log(`\nDeploy plan: ${selected.join(', ')}${dryRun ? '  (dry run)' : ''}\n`)

// --- Deploy each target with capture-prev + rollback ---

const failures = []

for (const name of selected) {
  const t = TARGETS[name]
  const scriptPath = resolve(SCRIPTS_DIR, t.script)
  console.log(`\n\x1b[36m▶ ${name}\x1b[0m`)

  if (dryRun) {
    console.log(`  would run: ${scriptPath}`)
    if (t.service) console.log(`  rollback-armed: readlink ${t.base}/current → restore + restart ${t.service} on failure`)
    else console.log(`  static target — no service restart / rollback`)
    continue
  }

  // Capture the live release so we can restore it if the deploy fails.
  let prev = ''
  if (t.service) {
    try { prev = ssh(`readlink ${t.base}/current 2>/dev/null || true`) }
    catch { prev = '' }
    console.log(`  previous release: ${prev || '<none>'}`)
  }

  const res = spawnSync('bash', [scriptPath], { cwd: ROOT, stdio: 'inherit', env: process.env })

  if (res.status === 0) {
    console.log(`\x1b[32m✓ ${name} deployed\x1b[0m`)
    continue
  }

  console.error(`\x1b[31m✗ ${name} failed (exit ${res.status})\x1b[0m`)
  failures.push(name)

  // Roll back only to a release path we recognise (defends against a
  // garbage readlink), and only when there is a service to restart.
  if (t.service && prev.startsWith(`${t.base}/releases/`)) {
    console.error(`  ↩ rolling back to ${prev}`)
    try {
      ssh(`ln -sfn ${prev} ${t.base}/current && sudo systemctl restart ${t.service}`)
      console.error(`  ✓ rolled back`)
    } catch (e) {
      console.error(`  ✗ rollback failed: ${e.message}`)
    }
  } else if (t.service) {
    console.error(`  (no valid previous release to roll back to)`)
  }
}

if (failures.length) {
  console.error(`\n\x1b[31m✗ failed: ${failures.join(', ')}\x1b[0m`)
  process.exit(1)
}

console.log(`\n\x1b[32m✅ deployed: ${selected.join(', ')}\x1b[0m`)
