import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function parseCredentialJSON(cache: string): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(cache) }
  catch { throw new Error('Invalid credential cache JSON; reconnect this connection') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(cache) > 10 * 1024 * 1024) throw new Error('Invalid credential cache JSON')
  return value as Record<string, unknown>
}

export interface CredentialCipher { available: () => boolean, encrypt: (value: string) => Buffer, decrypt: (value: Buffer) => string }
export class CredentialCache {
  private queues = new Map<string, (() => void)[]>()
  constructor(private readonly root: string, private readonly cipher: CredentialCipher) {}

  private path(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid connection reference')
    if (!this.cipher.available()) throw new Error('Credential store is locked; reconnect after unlocking')
    return join(this.root, `${id}.encrypted`)
  }

  private async acquire(id: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const queue = this.queues.get(id)
    if (!queue) { this.queues.set(id, []); return }
    await new Promise<void>((resolve, reject) => {
      let enter: () => void
      const stop = () => { const index = queue.indexOf(enter); if (index >= 0) queue.splice(index, 1); reject(signal?.reason ?? new Error('Connection read cancelled')) }
      enter = () => { signal?.removeEventListener('abort', stop); resolve() }
      queue.push(enter); signal?.addEventListener('abort', stop, { once: true })
      if (signal?.aborted) stop()
    })
  }

  private release(id: string): void {
    const next = this.queues.get(id)?.shift()
    if (next) next()
    else this.queues.delete(id)
  }

  private async persist(id: string, cache: string): Promise<void> {
    parseCredentialJSON(cache)
    const target = this.path(id)
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const staging = join(this.root, `.stage-${randomUUID()}`)
    const file = await open(staging, 'wx', 0o600)
    try { await file.writeFile(this.cipher.encrypt(cache)); await file.sync() }
    finally { await file.close() }
    await rename(staging, target)
    const directory = await open(this.root, 'r')
    try { await directory.sync() }
    finally { await directory.close() }
  }

  async create(id: string, cache: string): Promise<void> {
    this.path(id); await this.acquire(id)
    try {
      try { await readFile(this.path(id)); throw new Error('Connection already exists') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await this.persist(id, cache)
    }
    finally { this.release(id) }
  }

  async connect(id: string, cache: string): Promise<void> {
    this.path(id); await this.acquire(id)
    try { await this.persist(id, cache) }
    finally { this.release(id) }
  }

  async withCache<T>(id: string, operation: (file: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.path(id); await this.acquire(id, signal)
    let temporary: string | undefined
    try {
      signal?.throwIfAborted()
      const plaintext = this.cipher.decrypt(await readFile(this.path(id)))
      parseCredentialJSON(plaintext)
      const temporaryRoot = join(this.root, 'temporary'); await mkdir(temporaryRoot, { recursive: true, mode: 0o700 })
      temporary = await mkdtemp(join(temporaryRoot, `${id}-`))
      const path = join(temporary, 'token.json'); await writeFile(path, plaintext, { flag: 'wx', mode: 0o600 })
      let outcome: { ok: true, value: T } | { ok: false, error: unknown }
      try { outcome = { ok: true, value: await operation(path) } }
      catch (error) { outcome = { ok: false, error } }
      try { await this.persist(id, await readFile(path, 'utf8')) }
      catch (error) {
        if (!outcome.ok) throw new AggregateError([outcome.error, error], 'Tool failed and its authentication cache could not be saved')
        throw error
      }
      if (!outcome.ok) throw outcome.error
      return outcome.value
    }
    finally {
      try { if (temporary) await rm(temporary, { recursive: true, force: true }) }
      finally { this.release(id) }
    }
  }
}
