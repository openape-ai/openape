import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rename, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

export function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function read<T = Record<string, unknown>>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function save(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  await rename(temporary, path)
}

export async function immutable(path: string, value: unknown): Promise<void> {
  const prior = await read(path)
  if (prior !== null && !isDeepStrictEqual(prior, value)) throw new Error('Immutable input changed; a new identity and approval are required')
  if (prior !== null) return
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  try { await link(temporary, path) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  finally { await unlink(temporary) }
  if (!isDeepStrictEqual(await read(path), value)) throw new Error('Immutable input conflict; another writer published different content')
}

export async function records(root: string): Promise<string[]> {
  return (await readdir(root)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort().map(name => join(root, name))
}

export function jsonAnswer(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''))
}

export function finish(status: string, summary: string) {
  return { status, summary, completedInputIds: [], gapIds: [] }
}
