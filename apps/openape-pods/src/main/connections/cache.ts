import { parseCredentialAlias, parseCredentialValue } from '../../contracts/credentials'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
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

  async eraseConnection(id: string): Promise<void> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid connection reference')
    await this.acquire(id)
    try { await rm(join(this.root, `${id}.encrypted`), { force: true }) }
    finally { this.release(id) }
  }

  async erasePodKey(id: string, podId: string): Promise<void> {
    this.path(id); await this.acquire(id)
    try {
      let bytes: Buffer
      try { bytes = await readFile(this.path(id)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
      const value = parseCredentialJSON(this.cipher.decrypt(bytes))
      if (value.podId !== podId || (typeof value.privateKey !== 'string' && !['script-credential', 'program-state'].includes(String(value.kind)))) throw new Error('Refusing to erase a shared or foreign connection')
      await rm(this.path(id)); await rm(join(this.root, `.script-${id}.json`), { force: true }); const directory = await open(this.root, 'r')
      try { await directory.sync() }
      finally { await directory.close() }
    }
    finally { this.release(id) }
  }

  async createScriptSecret(podId: string, alias: string, value: string): Promise<string> {
    return this.createPodRecord(podId, { kind: 'script-credential', alias: parseCredentialAlias(alias), value: parseCredentialValue(value) })
  }

  async createPodRecord(podId: string, record: Record<string, unknown>): Promise<string> {
    if (!/^[a-f0-9-]{36}$/.test(podId)) throw new Error('Invalid credential pod identity')
    const id = randomUUID()
    this.path(id); await mkdir(this.root, { recursive: true, mode: 0o700 })
    const marker = await open(join(this.root, `.script-${id}.json`), 'wx', 0o600)
    try { await marker.writeFile(JSON.stringify({ id, podId })); await marker.sync() }
    finally { await marker.close() }
    const directory = await open(this.root, 'r')
    try { await directory.sync() }
    finally { await directory.close() }
    await this.create(id, JSON.stringify({ ...record, podId }))
    return id
  }

  async reconcileScriptSecrets(assignments: { id: string, podId: string }[]): Promise<void> {
    let names: string[]
    try { names = await readdir(this.root) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    for (const name of names.filter(name => /^\.script-[a-f0-9-]{36}\.json$/.test(name))) {
      const marker = JSON.parse(await readFile(join(this.root, name), 'utf8')) as { id: string, podId: string }
      if (!marker || name !== `.script-${marker.id}.json` || typeof marker.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(marker.podId)) throw new Error('Invalid script credential recovery record')
      if (assignments.some(item => item.id === marker.id && item.podId === marker.podId)) continue
      await this.erasePodKey(marker.id, marker.podId)
      await rm(join(this.root, name), { force: true })
    }
  }

  async readScriptSecret(id: string, podId: string, alias: string): Promise<string> {
    this.path(id); parseCredentialAlias(alias); await this.acquire(id)
    try {
      const value = parseCredentialJSON(this.cipher.decrypt(await readFile(this.path(id))))
      if (value.kind !== 'script-credential' || value.podId !== podId) throw new Error('Credential belongs to another pod or is not a script credential')
      if (value.alias !== alias) throw new Error('Credential alias does not match its assignment')
      return parseCredentialValue(value.value)
    }
    finally { this.release(id) }
  }

  async readConnection(id: string): Promise<Record<string, unknown>> {
    this.path(id); await this.acquire(id)
    try { return parseCredentialJSON(this.cipher.decrypt(await readFile(this.path(id)))) }
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
