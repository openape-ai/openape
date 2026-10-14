#!/usr/bin/env tsx
/**
 * Seed the IdP `shapes` table from the shapes-registry repo.
 *
 * Usage (after `pnpm --filter @openape/shapes... build`):
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

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadAdapter } from '@openape/shapes'
import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { shapes } from '../apps/openape-free-idp/server/database/schema'
import type { ServerShape } from '@openape/grants'

interface AdapterMeta {
  description: string
}

function resolveRegistryPath(): string {
  if (process.env.SHAPES_REGISTRY_PATH) return resolve(process.env.SHAPES_REGISTRY_PATH)
  return resolve(import.meta.dirname ?? __dirname, '..', '..', 'shapes-registry')
}

/**
 * Parses with the same strict parser as apes and Pods, so the stored
 * operations, presentation, versions and digest equal what they compute.
 */
function loadShape(dir: string, cliId: string): ServerShape | null {
  const adapterPath = join(dir, 'adapter.toml')
  const metaPath = join(dir, 'meta.json')
  if (!existsSync(adapterPath)) return null

  const { adapter, digest } = loadAdapter(cliId, adapterPath)
  const meta: AdapterMeta | null = existsSync(metaPath)
    ? (JSON.parse(readFileSync(metaPath, 'utf-8')) as AdapterMeta)
    : null
  const { tested_versions, version_command, version_pattern } = adapter.cli

  const now = Math.floor(Date.now() / 1000)
  return {
    cli_id: adapter.cli.id,
    executable: adapter.cli.executable,
    description: meta?.description ?? '',
    operations: adapter.operations,
    source: 'builtin',
    digest,
    ...(tested_versions && version_command && version_pattern ? { versions: { tested_versions, version_command, version_pattern } } : {}),
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

  // Parse every adapter before writing, so one invalid adapter leaves the table untouched.
  const loaded = entries.map(entry => loadShape(join(adaptersDir, entry), entry)).filter(shape => shape !== null)
  console.log(`Seeding ${loaded.length} shape(s) from ${registryPath}...`)

  for (const shape of loaded) {
    await db.insert(shapes).values({
      cliId: shape.cli_id,
      executable: shape.executable,
      description: shape.description,
      operations: shape.operations,
      source: shape.source,
      digest: shape.digest,
      versions: shape.versions ?? null,
      createdAt: shape.createdAt,
      updatedAt: shape.updatedAt,
    }).onConflictDoUpdate({
      target: shapes.cliId,
      set: {
        executable: shape.executable,
        description: shape.description,
        operations: shape.operations,
        digest: shape.digest,
        versions: shape.versions ?? null,
        updatedAt: shape.updatedAt,
        source: 'builtin',
      },
    })
    console.log(`  ✓ ${shape.cli_id} (${shape.operations.length} operations${shape.versions ? `, tested ${shape.versions.tested_versions.join(', ')}` : ''})`)
  }

  console.log(`Done: ${loaded.length} seeded.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
