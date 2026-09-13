import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface CredentialCipher { available: () => boolean, encrypt: (value: string) => Buffer, decrypt: (value: Buffer) => string }
export class CredentialCache {
  private queues = new Map<string, (() => void)[]>()
  constructor(private readonly root: string, private readonly cipher: CredentialCipher) {}

  private path(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid connection reference')
    if (!this.cipher.available()) throw new Error('Credential store is locked; reconnect after unlocking')
    return join(this.root, `${id}.encrypted`)
  }

  private async acquire(id: string): Promise<void> {
    const queue = this.queues.get(id)
    if (queue) { await new Promise<void>(resolve => queue.push(resolve)); return }
    this.queues.set(id, [])
  }

  private release(id: string): void {
    const next = this.queues.get(id)?.shift()
    if (next) next()
    else this.queues.delete(id)
  }

  private async persist(id: string, cache: string): Promise<void> {
    const value: unknown = JSON.parse(cache)
    if (!value || typeof value !== 'object' || Array.isArray(value) || cache.length > 10 * 1024 * 1024) throw new Error('Invalid credential cache JSON')
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

  async connect(id: string, cache: string): Promise<void> {
    this.path(id); await this.acquire(id)
    try { await this.persist(id, cache) }
    finally { this.release(id) }
  }

  async withCache<T>(id: string, operation: (file: string) => Promise<T>): Promise<T> {
    this.path(id); await this.acquire(id)
    let temporary: string | undefined
    try {
      const plaintext = this.cipher.decrypt(await readFile(this.path(id)))
      JSON.parse(plaintext)
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
