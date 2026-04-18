#!/usr/bin/env tsx
/**
 * Seed the IdP `shapes` table from the shapes-registry repo.
 *
 * Usage:
 *   SHAPES_REGISTRY_PATH=/path/to/shapes-registry \
 *   TURSO_URL=... TURSO_AUTH_TOKEN=... \
 *   pnpm seed:shapes
 *
 * Defaults to `../shapes-registry` (sibling of openape-monorepo) when no
 * env var is provided.
 *
 * The script is idempotent: it uses `onConflictDoUpdate` keyed on `cli_id`
 * so re-running updates content but preserves created_at. Only `builtin`
 * shapes are touched — any `custom` shapes in the table are left alone.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { shapes } from '../apps/openape-free-idp/server/database/schema'
import type { ServerShape, ServerShapeOperation } from '@openape/grants'

interface AdapterTomlOperation {
  id: string
  command?: string[]
  positionals?: string[]
  required_options?: string[]
  display: string
  action: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  resource_chain?: string[]
  exact_command?: boolean
}

interface AdapterToml {
  schema: string
  cli: { id: string, executable: string, audience?: string, version?: string }
  operation?: AdapterTomlOperation[]
}

interface AdapterMeta {
  id: string
  name: string
  description: string
  executable: string
}

function resolveRegistryPath(): string {
  if (process.env.SHAPES_REGISTRY_PATH) return resolve(process.env.SHAPES_REGISTRY_PATH)
  return resolve(import.meta.dirname ?? __dirname, '..', '..', 'shapes-registry')
}

function loadShape(dir: string): ServerShape | null {
  const adapterPath = join(dir, 'adapter.toml')
  const metaPath = join(dir, 'meta.json')
  if (!existsSync(adapterPath)) return null

  const adapterContent = readFileSync(adapterPath, 'utf-8')
  const adapter = parseToml(adapterContent) as unknown as AdapterToml
  const meta: AdapterMeta | null = existsSync(metaPath)
    ? (JSON.parse(readFileSync(metaPath, 'utf-8')) as AdapterMeta)
    : null

  const cliId = adapter.cli.id
  const operations: ServerShapeOperation[] = (adapter.operation ?? []).map(op => ({
    id: op.id,
    command: op.command ?? [],
    positionals: op.positionals,
    required_options: op.required_options,
    display: op.display,
    action: op.action,
    risk: op.risk,
    resource_chain: op.resource_chain ?? [],
    exact_command: op.exact_command,
  }))

  const now = Math.floor(Date.now() / 1000)
  const digest = `sha256:${createHash('sha256').update(adapterContent).digest('hex')}`
  return {
    cli_id: cliId,
    executable: adapter.cli.executable,
    description: meta?.description ?? '',
    operations,
    source: 'builtin',
    digest,
    createdAt: now,
    updatedAt: now,
  }
}

async function main() {
  const registryPath = resolveRegistryPath()
  const adaptersDir = join(registryPath, 'adapters')
  if (!existsSync(adaptersDir)) {
    console.error(`Registry adapters dir not found: ${adaptersDir}`)
    console.error(`Set SHAPES_REGISTRY_PATH to point at the shapes-registry repo.`)
    process.exit(1)
  }

  const tursoUrl = process.env.TURSO_URL
  const tursoToken = process.env.TURSO_AUTH_TOKEN
  if (!tursoUrl) {
    console.error(`TURSO_URL is required`)
    process.exit(1)
  }

  const db = drizzle(createClient({ url: tursoUrl, authToken: tursoToken }))

  const entries = readdirSync(adaptersDir).filter((name) => {
    const full = join(adaptersDir, name)
    return statSync(full).isDirectory() && existsSync(join(full, 'adapter.toml'))
  })

  console.log(`Seeding ${entries.length} shape(s) from ${registryPath}...`)
  let seeded = 0
  let skipped = 0

  for (const entry of entries) {
    const shape = loadShape(join(adaptersDir, entry))
    if (!shape) {
      skipped += 1
      console.warn(`Skipped ${entry} (no adapter.toml)`)
      continue
    }
    await db.insert(shapes).values({
      cliId: shape.cli_id,
      executable: shape.executable,
      description: shape.description,
      operations: shape.operations,
      source: shape.source,
      digest: shape.digest,
      createdAt: shape.createdAt,
      updatedAt: shape.updatedAt,
    }).onConflictDoUpdate({
      target: shapes.cliId,
      set: {
        executable: shape.executable,
        description: shape.description,
        operations: shape.operations,
        digest: shape.digest,
        updatedAt: shape.updatedAt,
        source: 'builtin',
      },
    })
    seeded += 1
    console.log(`  ✓ ${shape.cli_id} (${shape.operations.length} operations)`)
  }

  console.log(`Done: ${seeded} seeded, ${skipped} skipped.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
