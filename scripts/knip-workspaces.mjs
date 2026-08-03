#!/usr/bin/env node
// Runs knip once per workspace instead of once for the whole monorepo.
//
// Why: knip's Nuxt plugin registers the auto-import compiler into a map that is
// shared across all workspaces, and the first registration wins (knip 6.23.0,
// graph/build.js -> `if (compilers[0].has(ext)) return`). The first Nuxt
// workspace knip visits therefore donates its `.nuxt/components.d.ts` and
// `.nuxt/imports.d.ts` maps to every other Nuxt workspace, whose own components
// and composables then look unreferenced. One workspace per process keeps every
// map correct.
//
// Packages and modules are unaffected by the bug; they are analysed the same way
// here and produce identical findings either way (verified 2026-08-03).

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACE_GROUPS = ['packages', 'modules', 'apps']

const workspaces = ['.']
for (const group of WORKSPACE_GROUPS) {
  const groupDir = join(rootDir, group)
  if (!existsSync(groupDir)) continue
  for (const name of readdirSync(groupDir).sort()) {
    if (existsSync(join(groupDir, name, 'package.json'))) workspaces.push(`${group}/${name}`)
  }
}

const knipArgs = process.argv.slice(2)
const failed = []

for (const workspace of workspaces) {
  const result = spawnSync(
    'knip',
    ['--workspace', workspace, '--no-exit-code', ...knipArgs],
    { cwd: rootDir, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' },
  )
  if (result.error) throw result.error
  const output = result.stdout.trim()
  if (!output) continue
  failed.push(workspace)
  process.stdout.write(`\n=== ${workspace} ===\n${output}\n`)
}

if (failed.length === 0) {
  process.stdout.write(`knip: clean across ${workspaces.length} workspaces\n`)
  process.exit(0)
}

process.stdout.write(`\nknip: findings in ${failed.length} of ${workspaces.length} workspaces\n`)
process.exit(1)
