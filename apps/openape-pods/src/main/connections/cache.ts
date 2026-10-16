import { parsePortableCredential, validatePortableValue } from './portable'
import type { PortableBinding, PortableCredential } from './portable'
import { parseCredentialAlias, parseCredentialValue } from '../../contracts/credentials'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function parseCredentialJSON(cache: string): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(cache) }
  catch { throw new Error('Invalid credential cache JSON; reconnect this connection') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(cache) > 10 * 1024 * 1024) throw new Error('Invalid credential cache JSON')
  return value as Record<string, unknown>
}

function podIdentity(value: Record<string, unknown>): boolean {
  return typeof value.podId === 'string' && /^[a-f0-9-]{36}$/.test(value.podId)
    && ['issuer', 'owner', 'privateKey', 'publicKey', 'keyId'].every(key => typeof value[key] === 'string' && value[key])
}

export interface CredentialCipher { available: () => boolean, encrypt: (value: string) => Buffer, decrypt: (value: Buffer) => string }
export class CredentialCache {
  private queues = new Map<string, (() => void)[]>()
  constructor(private readonly root: string, private readonly cipher?: CredentialCipher) {}

  private path(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid connection reference')
    return join(this.root, `${id}.encrypted`)
  }

  private identityPath(id: string): string { this.path(id); return join(this.root, `${id}.identity.json`) }

  private async privateDirectory(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const info = await lstat(this.root)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Credential directory must be a real directory')
    await chmod(this.root, 0o700)
  }

  private portablePath(id: string): string { this.path(id); return join(this.root, `${id}.credential.json`) }

  private async readPrivate(path: string): Promise<string> {
    const directory = await lstat(this.root)
    if (!directory.isDirectory() || directory.isSymbolicLink() || (process.platform !== 'win32' && (directory.mode & 0o077))) throw new Error('Credential directory must be private')
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const info = await file.stat()
      if (info.size > 10 * 1024 * 1024) throw new Error('Invalid credential cache size')
      if (!info.isFile() || info.nlink !== 1 || (process.platform !== 'win32' && (info.mode & 0o077))) throw new Error('Credential file must be private with a single link')
      const text = await file.readFile('utf8')
      return text
    }
    finally { await file.close() }
  }

  private async readIdentity(id: string): Promise<string> {
    const text = await this.readPrivate(this.identityPath(id))
    if (!podIdentity(parseCredentialJSON(text))) throw new Error('Invalid Pod identity file')
    return text
  }

  private async portable(id: string): Promise<PortableCredential | undefined> {
    try { return parsePortableCredential(parseCredentialJSON(await this.readPrivate(this.portablePath(id))), id) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }

  private async read(id: string): Promise<string> {
    try {
      const identity = await this.readIdentity(id)
      if (await this.portable(id)) throw new Error('Conflicting credential representations')
      return identity
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const portable = await this.portable(id)
    if (portable) return JSON.stringify(portable.value)
    const bytes = await readFile(this.path(id))
    if (!this.cipher?.available()) throw new Error('Credential store is locked or unavailable; unmigrated credentials require the desktop credential store; open the updated desktop once to migrate eligible credentials')
    const text = this.cipher.decrypt(bytes)
    if (podIdentity(parseCredentialJSON(text))) await this.persist(id, text)
    return text
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

  private async persist(id: string, cache: string, selected?: PortableBinding): Promise<void> {
    const value = parseCredentialJSON(cache)
    const identity = podIdentity(value)
    const portable = await this.portable(id)
    const binding = selected ?? portable?.binding
    if (binding && identity) throw new Error('Cannot replace a portable credential with a Pod identity')
    if (binding) validatePortableValue(value, binding)
    let bytes: string | Buffer = cache
    if (!identity && !binding) {
      if (!this.cipher?.available()) throw new Error('Application credential store is locked or unavailable; use the desktop credential store')
      bytes = this.cipher.encrypt(cache)
      try { await lstat(this.identityPath(id)); throw new Error('Cannot replace a Pod identity with another credential type') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    if (binding) {
      try { await lstat(this.identityPath(id)); throw new Error('Cannot replace a Pod identity with a portable credential') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      bytes = JSON.stringify({ version: 1, id, binding, value })
    }
    const target = identity ? this.identityPath(id) : binding ? this.portablePath(id) : this.path(id)
    await this.privateDirectory()
    const staging = join(this.root, `.stage-${randomUUID()}`)
    try {
      const file = await open(staging, 'wx', 0o600)
      try { await file.writeFile(bytes); await file.sync() }
      finally { await file.close() }
      await rename(staging, target)
      const directory = await open(this.root, 'r')
      try {
        await directory.sync()
        if (identity || binding) { await rm(this.path(id), { force: true }); await directory.sync() }
      }
      finally { await directory.close() }
    }
    finally { await rm(staging, { force: true }) }
  }

  private async migrate(id: string, binding: PortableBinding, signal?: AbortSignal): Promise<void> {
    this.path(id); await this.acquire(id, signal)
    try {
      const portable = await this.portable(id)
      if (portable) {
        if (portable.binding.kind !== binding.kind) throw new Error('Portable credential kind changed; review its assignment')
        validatePortableValue(portable.value, binding)
        return
      }
      const text = await this.read(id)
      validatePortableValue(parseCredentialJSON(text), binding)
      signal?.throwIfAborted()
      await this.persist(id, text, binding)
    }
    finally { this.release(id) }
  }

  async migrateHttp(id: string, podId: string, alias: string, signal?: AbortSignal): Promise<void> {
    await this.migrate(id, { kind: 'http', podId, alias }, signal)
  }

  async migrateChatgpt(id: string, accountId: string, signal?: AbortSignal): Promise<void> {
    await this.migrate(id, { kind: 'chatgpt', accountId }, signal)
  }

  async readHttpSecret(id: string, podId: string, alias: string, signal?: AbortSignal): Promise<string> {
    await this.migrateHttp(id, podId, alias, signal)
    signal?.throwIfAborted()
    return this.readScriptSecret(id, podId, alias)
  }

  async create(id: string, cache: string): Promise<void> {
    this.path(id); await this.acquire(id)
    try {
      for (const path of [this.identityPath(id), this.portablePath(id), this.path(id)]) {
        try { await lstat(path); throw new Error('Connection already exists') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
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
    try {
      await rm(this.identityPath(id), { force: true }); await rm(this.portablePath(id), { force: true }); await rm(this.path(id), { force: true })
      try {
        const directory = await open(this.root, 'r')
        try { await directory.sync() }
        finally { await directory.close() }
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    finally { this.release(id) }
  }

  async erasePodKey(id: string, podId: string): Promise<void> {
    this.path(id); await this.acquire(id)
    try {
      let text: string
      try { text = await this.read(id) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
      const value = parseCredentialJSON(text)
      if (value.podId !== podId || (typeof value.privateKey !== 'string' && !['script-credential', 'program-state'].includes(String(value.kind)))) throw new Error('Refusing to erase a shared or foreign connection')
      await rm(this.identityPath(id), { force: true }); await rm(this.portablePath(id), { force: true }); await rm(this.path(id), { force: true }); await rm(join(this.root, `.script-${id}.json`), { force: true }); const directory = await open(this.root, 'r')
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
      const value = parseCredentialJSON(await this.read(id))
      if (value.kind !== 'script-credential' || value.podId !== podId) throw new Error('Credential belongs to another pod or is not a script credential')
      if (value.alias !== alias) throw new Error('Credential alias does not match its assignment')
      return parseCredentialValue(value.value)
    }
    finally { this.release(id) }
  }

  async readConnection(id: string): Promise<Record<string, unknown>> {
    this.path(id); await this.acquire(id)
    try { return parseCredentialJSON(await this.read(id)) }
    finally { this.release(id) }
  }

  async withCache<T>(id: string, operation: (file: string) => Promise<T>, signal?: AbortSignal, chatgptLogin = false): Promise<T> {
    this.path(id); await this.acquire(id, signal)
    let temporary: string | undefined
    try {
      signal?.throwIfAborted()
      const plaintext = await this.read(id)
      parseCredentialJSON(plaintext)
      const temporaryRoot = join(this.root, 'temporary'); await mkdir(temporaryRoot, { recursive: true, mode: 0o700 })
      temporary = await mkdtemp(join(temporaryRoot, `${id}-`))
      const path = join(temporary, 'token.json'); await writeFile(path, plaintext, { flag: 'wx', mode: 0o600 })
      let outcome: { ok: true, value: T } | { ok: false, error: unknown }
      try { outcome = { ok: true, value: await operation(path) } }
      catch (error) { outcome = { ok: false, error } }
      try {
        const updated = await readFile(path, 'utf8')
        let binding: PortableBinding | undefined
        if (chatgptLogin && outcome.ok) {
          const value = parseCredentialJSON(updated)
          const accountId = (value.tokens as { account_id?: unknown } | undefined)?.account_id
          if (typeof accountId !== 'string') throw new Error('ChatGPT login account is missing')
          const previous = await this.portable(id)
          if (previous && previous.binding.kind !== 'chatgpt') throw new Error('Cannot replace another credential type with ChatGPT')
          binding = { kind: 'chatgpt', accountId }
        }
        await this.persist(id, updated, binding)
      }
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
