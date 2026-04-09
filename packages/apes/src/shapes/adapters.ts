import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { LoadedAdapter } from './types.js'
import { parseAdapterToml } from './toml.js'

function digest(content: string): string {
  return `SHA-256:${createHash('sha256').update(content).digest('hex')}`
}

function adapterDirs(): string[] {
  return [
    join(process.cwd(), '.openape', 'shapes', 'adapters'),
    join(homedir(), '.openape', 'shapes', 'adapters'),
    join('/etc', 'openape', 'shapes', 'adapters'),
  ]
}

function findByExecutable(executable: string): string | undefined {
  for (const dir of adapterDirs()) {
    if (!existsSync(dir))
      continue
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.toml'))
      for (const file of files) {
        const path = join(dir, file)
        const content = readFileSync(path, 'utf-8')
        const match = content.match(/^\s*executable\s*=\s*"([^"]+)"/m)
        if (match && match[1] === executable)
          return path
      }
    }
    catch {
      // directory not readable
    }
  }
  return undefined
}

export function resolveAdapterPath(cliId: string, explicitPath?: string): string {
  if (explicitPath) {
    if (existsSync(explicitPath))
      return explicitPath
    throw new Error(`Adapter file not found: ${explicitPath}`)
  }

  // Try direct lookup by ID
  const candidates = adapterDirs().map(dir => join(dir, `${cliId}.toml`))
  const match = candidates.find(path => existsSync(path))
  if (match)
    return match

  // Fallback: scan for adapter with matching executable name
  const byExec = findByExecutable(cliId)
  if (byExec)
    return byExec

  throw new Error(`No adapter found for ${cliId}`)
}

export function loadAdapter(cliId: string, explicitPath?: string): LoadedAdapter {
  const source = resolveAdapterPath(cliId, explicitPath)
  const content = readFileSync(source, 'utf-8')
  const adapter = parseAdapterToml(content)

  // Accept if either the adapter ID or the executable matches the requested cliId
  const idMatch = adapter.cli.id === cliId
  const fileMatch = basename(source) === `${cliId}.toml`
  const execMatch = adapter.cli.executable === cliId
  if (!idMatch && !fileMatch && !execMatch)
    throw new Error(`Adapter ${source} does not match requested CLI ${cliId}`)

  return {
    adapter,
    source,
    digest: digest(content),
  }
}

/** Try to load an adapter locally, return null instead of throwing when not found. */
export function tryLoadAdapter(cliId: string, explicitPath?: string): LoadedAdapter | null {
  try {
    return loadAdapter(cliId, explicitPath)
  }
  catch {
    return null
  }
}
