import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LoadedAdapter } from './types.js'
import { parseAdapterToml } from './toml.js'

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))

function digest(content: string): string {
  return `SHA-256:${createHash('sha256').update(content).digest('hex')}`
}

function bundledAdapterPath(cliId: string): string {
  return join(PACKAGE_DIR, '..', 'adapters', `${cliId}.toml`)
}

export function resolveAdapterPath(cliId: string, explicitPath?: string): string {
  const candidates = explicitPath
    ? [explicitPath]
    : [
        join(process.cwd(), '.openape', 'shapes', 'adapters', `${cliId}.toml`),
        join(homedir(), '.openape', 'shapes', 'adapters', `${cliId}.toml`),
        join('/etc', 'openape', 'shapes', 'adapters', `${cliId}.toml`),
        bundledAdapterPath(cliId),
      ]

  const match = candidates.find(path => existsSync(path))
  if (!match)
    throw new Error(`No adapter found for ${cliId}`)

  return match
}

export function loadAdapter(cliId: string, explicitPath?: string): LoadedAdapter {
  const source = resolveAdapterPath(cliId, explicitPath)
  const content = readFileSync(source, 'utf-8')
  const adapter = parseAdapterToml(content)

  if (adapter.cli.id !== cliId && basename(source) !== `${cliId}.toml`) {
    throw new Error(`Adapter ${source} does not match requested CLI ${cliId}`)
  }

  return {
    adapter,
    source,
    digest: digest(content),
  }
}
