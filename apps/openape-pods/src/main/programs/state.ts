import { constants } from 'node:fs'
import { mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CredentialCache } from '../connections/cache'

interface Binding { podId: string, applicationId: string }
interface StateFile { path: string, content: string }
interface Bundle extends Binding { kind: 'program-state', generation: number, files: StateFile[] }
const maximumBytes = 4 * 1024 * 1024
const maximumFiles = 128
function assertBinding(binding: Binding): void {
  if (![binding.podId, binding.applicationId].every(value => /^[a-f0-9-]{36}$/.test(value))) throw new Error('Invalid application state binding')
}
function parseBundle(value: unknown, binding: Binding): Bundle {
  const bundle = value as Bundle
  if (!bundle || bundle.kind !== 'program-state' || bundle.podId !== binding.podId || bundle.applicationId !== binding.applicationId) throw new Error('State belongs to another application or pod')
  if (!Number.isSafeInteger(bundle.generation) || bundle.generation < 0 || !Array.isArray(bundle.files) || bundle.files.length > maximumFiles) throw new Error('Invalid application state generation')
  let size = 0; const paths = new Set<string>()
  for (const file of bundle.files) {
    if (!file || typeof file.path !== 'string' || file.path.length > 1024 || file.path.split('/').some(part => !part || part === '.' || part === '..' || /[\\\0\r\n]/.test(part)) || paths.has(file.path) || typeof file.content !== 'string' || file.content.length > 4 * Math.ceil(maximumBytes / 3) || Buffer.from(file.content, 'base64').toString('base64') !== file.content) throw new Error('Invalid application state file')
    paths.add(file.path); size += Buffer.byteLength(file.content, 'base64')
    if (size > maximumBytes) throw new Error('Application state exceeds its size limit')
  }
  return bundle
}
async function capture(root: string): Promise<StateFile[]> {
  const files: StateFile[] = []; let size = 0; let entries = 0
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      if (++entries > maximumFiles * 2) throw new Error('Application state contains too many entries')
      const path = directory ? `${directory}/${entry.name}` : entry.name
      if (entry.isDirectory()) { await visit(path); continue }
      if (!entry.isFile()) throw new Error('Application state cannot contain links or special files')
      if (files.length >= maximumFiles) throw new Error('Application state contains too many files')
      const file = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const info = await file.stat()
        if (!info.isFile() || info.nlink !== 1) throw new Error('Application state cannot contain links or special files')
        size += info.size
        if (size > maximumBytes) throw new Error('Application state exceeds its size limit')
        const content = await file.readFile()
        if (content.length !== info.size) throw new Error('Application state changed during capture')
        files.push({ path, content: content.toString('base64') })
      }
      finally { await file.close() }
    }
  }
  await visit(''); return files
}
export class ProgramState {
  constructor(private readonly credentials: CredentialCache) {}

  async create(binding: Binding): Promise<string> {
    assertBinding(binding)
    return this.credentials.createPodRecord(binding.podId, { kind: 'program-state', ...binding, generation: 0, files: [] })
  }

  async use<T>(id: string, binding: Binding, closedSession: (directory: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
    assertBinding(binding)
    return this.credentials.withCache(id, async (record) => {
      const bundle = parseBundle(JSON.parse(await readFile(record, 'utf8')), binding)
      const root = join(dirname(record), 'application'); await mkdir(root, { mode: 0o700 })
      for (const file of bundle.files) {
        const path = join(root, file.path); await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await writeFile(path, Buffer.from(file.content, 'base64'), { flag: 'wx', mode: 0o600 })
      }
      const result = await closedSession(root)
      signal?.throwIfAborted()
      const next = parseBundle({ ...bundle, generation: bundle.generation + 1, files: await capture(root) }, binding)
      await writeFile(record, JSON.stringify(next), { mode: 0o600 })
      return result
    }, signal)
  }
}
