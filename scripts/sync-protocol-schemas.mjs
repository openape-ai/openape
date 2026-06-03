#!/usr/bin/env node
/**
 * Sync protocol schemas from a sibling ../protocol checkout into
 * packages/protocol-conformance/schemas/.
 *
 * Usage:
 *   node scripts/sync-protocol-schemas.mjs
 *   pnpm --filter @openape/protocol-conformance sync-schemas
 */

import { copyFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const protocolDir = join(repoRoot, '..', 'protocol', 'schemas')
const targetDir = join(repoRoot, 'packages', 'protocol-conformance', 'schemas')

if (!existsSync(protocolDir)) {
  console.error(`[sync-protocol-schemas] Protocol schemas directory not found: ${protocolDir}`)
  console.error('  Ensure the openape-ai/protocol repo is checked out as a sibling of this monorepo.')
  console.error('  Expected path: ../protocol/schemas relative to the monorepo root.')
  process.exit(1)
}

const files = readdirSync(protocolDir).filter(f => f.endsWith('.json'))

if (files.length === 0) {
  console.error(`[sync-protocol-schemas] No JSON files found in ${protocolDir}`)
  process.exit(1)
}

for (const file of files) {
  const src = join(protocolDir, file)
  const dst = join(targetDir, file)
  copyFileSync(src, dst)
  console.log(`  copied ${file}`)
}

console.log(`[sync-protocol-schemas] Synced ${files.length} schema file(s) from ${protocolDir}`)
