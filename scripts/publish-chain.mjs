#!/usr/bin/env node

/**
 * Publish all @openape packages in dependency order.
 *
 * Dependency chain:
 *   core → grants → proxy
 *        → auth   → nuxt-auth-sp
 *                 → nuxt-auth-idp
 *   core → openclaw-plugin-grants (depends on core, grants)
 *
 * For each package: compares local version vs npm, builds if needed,
 * publishes with --ignore-scripts (to avoid prepare/stub issues in Nuxt modules).
 *
 * Usage:
 *   node scripts/publish-chain.mjs              # publish all unpublished
 *   node scripts/publish-chain.mjs --dry-run    # show what would be published
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

const PACKAGES = [
  { name: '@openape/core', dir: 'packages/core' },
  { name: '@openape/grants', dir: 'packages/grants' },
  { name: '@openape/auth', dir: 'packages/auth' },
  { name: '@openape/proxy', dir: 'packages/proxy' },
  { name: '@openape/browser', dir: 'packages/browser' },
  { name: '@openape/shapes', dir: 'packages/shapes' },
  { name: '@openape/grapes', dir: 'packages/grapes' },
  { name: '@openape/unstorage-s3-driver', dir: 'packages/s3-driver' },
  { name: '@openape/openclaw-plugin-grants', dir: 'packages/openclaw-plugin-grants' },
  { name: '@openape/nuxt-auth-sp', dir: 'modules/nuxt-auth-sp' },
  { name: '@openape/nuxt-auth-idp', dir: 'modules/nuxt-auth-idp' },
]

const dryRun = process.argv.includes('--dry-run')

function getLocalVersion(dir) {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, dir, 'package.json'), 'utf-8'))
  return pkg.version
}

function getNpmVersion(name) {
  try {
    const result = execFileSync('npm', ['view', `${name}@latest`, 'version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return result.trim()
  } catch {
    return null // not yet published
  }
}

function build(dir) {
  const cwd = resolve(ROOT, dir)
  console.log(`  Building...`)
  execFileSync('pnpm', ['build'], { cwd, stdio: 'inherit' })
}

function publish(dir) {
  const cwd = resolve(ROOT, dir)
  console.log(`  Publishing...`)
  execFileSync('pnpm', ['publish', '--access', 'public', '--no-git-checks', '--ignore-scripts'], {
    cwd,
    stdio: 'inherit',
  })
}

// --- Main ---

console.log(dryRun ? '\n🔍 Dry run — nothing will be published\n' : '\n📦 Publishing @openape packages\n')

const toPublish = []

for (const pkg of PACKAGES) {
  const local = getLocalVersion(pkg.dir)
  const npm = getNpmVersion(pkg.name)

  if (local === npm) {
    console.log(`\x1b[2m⏭  ${pkg.name}@${local} — already on npm\x1b[0m`)
  } else {
    console.log(`\x1b[36m📦 ${pkg.name} ${npm || '(new)'} → ${local}\x1b[0m`)
    toPublish.push(pkg)
  }
}

if (toPublish.length === 0) {
  console.log('\n✅ All packages are up to date on npm.\n')
  process.exit(0)
}

if (dryRun) {
  console.log(`\nWould publish ${toPublish.length} package(s):\n`)
  for (const pkg of toPublish) {
    console.log(`  - ${pkg.name}@${getLocalVersion(pkg.dir)}`)
  }
  console.log()
  process.exit(0)
}

console.log(`\nPublishing ${toPublish.length} package(s) in dependency order:\n`)

const failures = []

for (const pkg of toPublish) {
  const version = getLocalVersion(pkg.dir)
  console.log(`\n\x1b[36m▶ ${pkg.name}@${version}\x1b[0m`)

  try {
    build(pkg.dir)
    publish(pkg.dir)
    console.log(`\x1b[32m✓ ${pkg.name}@${version} published\x1b[0m`)
  } catch (err) {
    console.error(`\x1b[31m✗ ${pkg.name}@${version} failed\x1b[0m`)
    failures.push(pkg.name)
    // Stop on failure — downstream packages depend on this
    console.error(`\n\x1b[31mStopping: ${pkg.name} failed, downstream packages would have wrong dependencies.\x1b[0m\n`)
    process.exit(1)
  }
}

console.log(`\n${'─'.repeat(50)}`)
console.log(`\x1b[32m✅ All ${toPublish.length} package(s) published successfully.\x1b[0m\n`)
