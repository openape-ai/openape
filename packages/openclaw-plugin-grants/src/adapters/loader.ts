import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LoadedAdapter } from './types.js'
import { parseAdapterToml } from './toml.js'

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))

function digest(content: string): string {
  return `SHA-256:${createHash('sha256').update(content).digest('hex')}`
}

function bundledAdapterDir(): string {
  // In dist/, adapters/ is at package root (sibling of dist/)
  return join(PACKAGE_DIR, '..', '..', 'adapters')
}

export interface AdapterSearchPaths {
  explicit?: string[]
  workspaceDir?: string
}

function getSearchDirs(options?: AdapterSearchPaths): string[] {
  const dirs: string[] = []

  if (options?.explicit) {
    dirs.push(...options.explicit)
  }

  if (options?.workspaceDir) {
    dirs.push(join(options.workspaceDir, '.openclaw', 'adapters'))
  }

  dirs.push(join(homedir(), '.openclaw', 'adapters'))
  dirs.push(bundledAdapterDir())

  return dirs
}

export function loadAdapterFromFile(filePath: string): LoadedAdapter {
  const content = readFileSync(filePath, 'utf-8')
  const adapter = parseAdapterToml(content)
  return {
    adapter,
    source: filePath,
    digest: digest(content),
  }
}

export function loadAdapter(cliId: string, options?: AdapterSearchPaths): LoadedAdapter {
  const dirs = getSearchDirs(options)

  for (const dir of dirs) {
    const filePath = join(dir, `${cliId}.toml`)
    if (existsSync(filePath)) {
      return loadAdapterFromFile(filePath)
    }
  }

  throw new Error(`No adapter found for CLI: ${cliId}`)
}

export function discoverAdapters(options?: AdapterSearchPaths): LoadedAdapter[] {
  const dirs = getSearchDirs(options)
  const seen = new Set<string>()
  const adapters: LoadedAdapter[] = []

  for (const dir of dirs) {
    if (!existsSync(dir))
      continue

    let entries: string[]
    try {
      entries = readdirSync(dir)
    }
    catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.endsWith('.toml'))
        continue

      const cliId = entry.slice(0, -5) // strip .toml
      if (seen.has(cliId))
        continue // higher-priority path already loaded this adapter

      try {
        const loaded = loadAdapterFromFile(join(dir, entry))
        seen.add(cliId)
        adapters.push(loaded)
      }
      catch {
        // Skip invalid adapters
      }
    }
  }

  return adapters
}
