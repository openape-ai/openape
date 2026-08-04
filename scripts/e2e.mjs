#!/usr/bin/env node
/**
 * Run the E2E suites the way CI does — locally, in one command.
 *
 *   pnpm e2e                  all four suites
 *   pnpm e2e --affected       only the suites this branch touches (vs origin/main)
 *   pnpm e2e --suite pr       one suite (core | testrun | pr | free-idp)
 *   pnpm e2e --list           print what would run, execute nothing
 *
 * Each suite boots a real Nuxt server, so this takes minutes; that is the
 * point. The step order mirrors .forgejo/workflows/e2e.yml: libraries are
 * built first, serially, because a dependency's .d.ts emitted mid-check
 * races the consumer reading it (#934).
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'

export const SUITES = [
  { name: 'core', label: 'self-contained idp+sp', task: 'test', filter: 'openape-e2e' },
  { name: 'testrun', label: 'proof-link round-trip (testrun)', task: 'test:e2e', filter: '@openape-testrun/app' },
  { name: 'pr', label: 'proof-link round-trip (ape-pr)', task: 'test:e2e', filter: '@openape-pr/app' },
  { name: 'free-idp', label: 'admin/login flows', task: 'test:e2e', filter: 'openape-free-idp' },
]

export function parseArgs(argv) {
  const args = { affected: false, list: false, suites: SUITES }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--affected') {
      args.affected = true
    }
    else if (arg === '--list') {
      args.list = true
    }
    else if (arg === '--suite') {
      const wanted = argv[++i]
      const suite = SUITES.find(s => s.name === wanted)
      if (!suite) throw new Error(`unknown suite "${wanted}" — pick one of ${SUITES.map(s => s.name).join(', ')}`)
      args.suites = [suite]
    }
    else {
      throw new Error(`unknown argument "${arg}"`)
    }
  }
  return args
}

/** The turbo invocation for one suite; `--affected` narrows it to changed packages. */
export function turboArgs(suite, affected) {
  return ['turbo', 'run', suite.task, ...(affected ? ['--affected'] : []), `--filter=${suite.filter}`]
}

function run(argv, { quiet = false } = {}) {
  return spawnSync('pnpm', argv, { stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' })
}

function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  }
  catch (err) {
    console.error(`✗ ${err.message}`)
    process.exit(2)
  }

  if (args.list) {
    for (const suite of args.suites) console.log(`${suite.name.padEnd(9)} ${suite.label}  →  pnpm ${turboArgs(suite, args.affected).join(' ')}`)
    return
  }

  if (args.affected && !process.env.TURBO_SCM_BASE) process.env.TURBO_SCM_BASE = 'origin/main'

  console.log('▸ building libraries (serial — deterministic .d.ts)')
  const build = run(['turbo', 'run', 'build', '--filter=./packages/*', '--filter=./modules/*', '--concurrency=1'])
  if (build.status !== 0) {
    console.error('✗ library build failed — suites not started')
    process.exit(build.status ?? 1)
  }

  const failed = []
  for (const suite of args.suites) {
    console.log(`\n▸ e2e: ${suite.name} — ${suite.label}`)
    const result = run(turboArgs(suite, args.affected))
    if (result.status !== 0) failed.push(suite.name)
  }

  console.log('')
  if (failed.length) {
    console.error(`✗ failed: ${failed.join(', ')}`)
    process.exit(1)
  }
  console.log(`✓ ${args.suites.length} suite(s) passed${args.affected ? ' (affected only — untouched apps were skipped)' : ''}`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
