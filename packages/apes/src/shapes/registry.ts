import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RegistryEntry, RegistryIndex } from './types.js'

const REGISTRY_URL = process.env.SHAPES_REGISTRY_URL
  ?? 'https://raw.githubusercontent.com/openape-ai/shapes-registry/main/registry.json'

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

function cacheDir(): string {
  return join(homedir(), '.openape', 'shapes', 'cache')
}

function cachePath(): string {
  return join(cacheDir(), 'registry.json')
}

function readCache(): RegistryIndex | null {
  const path = cachePath()
  if (!existsSync(path))
    return null

  try {
    const raw = readFileSync(path, 'utf-8')
    const stat = JSON.parse(raw) as RegistryIndex & { _cached_at?: number }
    if (stat._cached_at && Date.now() - stat._cached_at > CACHE_TTL_MS)
      return null
    return stat
  }
  catch {
    return null
  }
}

function writeCache(index: RegistryIndex): void {
  const dir = cacheDir()
  if (!existsSync(dir))
    mkdirSync(dir, { recursive: true })

  writeFileSync(cachePath(), JSON.stringify({ ...index, _cached_at: Date.now() }, null, 2))
}

export async function fetchRegistry(forceRefresh = false): Promise<RegistryIndex> {
  if (!forceRefresh) {
    const cached = readCache()
    if (cached)
      return cached
  }

  const response = await fetch(REGISTRY_URL)
  if (!response.ok)
    throw new Error(`Failed to fetch registry: ${response.status} ${response.statusText}`)

  const index = await response.json() as RegistryIndex
  writeCache(index)
  return index
}

export function searchAdapters(index: RegistryIndex, query: string): RegistryEntry[] {
  const q = query.toLowerCase()
  return index.adapters.filter(a =>
    a.id.includes(q)
    || a.name.toLowerCase().includes(q)
    || a.description.toLowerCase().includes(q)
    || a.tags.some(t => t.includes(q))
    || a.category.includes(q),
  )
}

export function findAdapter(index: RegistryIndex, id: string): RegistryEntry | undefined {
  return index.adapters.find(a => a.id === id)
}
