import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RegistryEntry } from './types.js'

function adapterDir(local: boolean): string {
  const base = local ? process.cwd() : homedir()
  return join(base, '.openape', 'shapes', 'adapters')
}

function adapterPath(id: string, local: boolean): string {
  return join(adapterDir(local), `${id}.toml`)
}

function sha256(content: string): string {
  return `SHA-256:${createHash('sha256').update(content).digest('hex')}`
}

export interface InstallResult {
  id: string
  path: string
  digest: string
  updated: boolean
}

export async function installAdapter(entry: RegistryEntry, options: { local?: boolean } = {}): Promise<InstallResult> {
  const local = options.local ?? false
  const dest = adapterPath(entry.id, local)
  const dir = adapterDir(local)

  const response = await fetch(entry.download_url)
  if (!response.ok)
    throw new Error(`Failed to download adapter ${entry.id}: ${response.status} ${response.statusText}`)

  const content = await response.text()
  const digest = sha256(content)

  if (digest !== entry.digest)
    throw new Error(`Digest mismatch for ${entry.id}: expected ${entry.digest}, got ${digest}`)

  const updated = existsSync(dest)

  if (!existsSync(dir))
    mkdirSync(dir, { recursive: true })

  writeFileSync(dest, content)

  return { id: entry.id, path: dest, digest, updated }
}

export function getInstalledDigest(id: string, local: boolean): string | null {
  const path = adapterPath(id, local)
  if (!existsSync(path))
    return null

  const content = readFileSync(path, 'utf-8')
  return sha256(content)
}

export function isInstalled(id: string, local: boolean): boolean {
  return existsSync(adapterPath(id, local))
}

export function getInstalledPath(id: string, local: boolean): string {
  return adapterPath(id, local)
}

export function removeAdapter(id: string, local: boolean): boolean {
  const path = adapterPath(id, local)
  if (!existsSync(path))
    return false
  unlinkSync(path)
  return true
}

export interface ConflictingAdapter {
  file: string
  path: string
  adapterId: string
  executable: string
}

export function findConflictingAdapters(executable: string, excludeId: string): ConflictingAdapter[] {
  const conflicts: ConflictingAdapter[] = []
  const dirs = [
    join(process.cwd(), '.openape', 'shapes', 'adapters'),
    join(homedir(), '.openape', 'shapes', 'adapters'),
  ]

  for (const dir of dirs) {
    if (!existsSync(dir))
      continue
    try {
      for (const file of readdirSync(dir).filter(f => f.endsWith('.toml'))) {
        const path = join(dir, file)
        const content = readFileSync(path, 'utf-8')
        const execMatch = content.match(/^\s*executable\s*=\s*"([^"]+)"/m)
        const idMatch = content.match(/^\s*id\s*=\s*"([^"]+)"/m)
        if (execMatch?.[1] === executable && idMatch?.[1] !== excludeId) {
          conflicts.push({ file, path, adapterId: idMatch?.[1] ?? file, executable })
        }
      }
    }
    catch {
      // directory not readable
    }
  }

  return conflicts
}
