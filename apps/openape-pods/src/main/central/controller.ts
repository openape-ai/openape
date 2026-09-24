import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { CentralClient, CentralCommand, CentralOperation, CentralSnapshot } from '../../contracts/central'
import { parseCentralSnapshot } from '../../contracts/central'
import { durableJSON, syncDirectory } from '../../worker/data/files'
import type { ArtifactCache } from './artifacts'
import { managedArtifacts } from './artifacts'

interface State { revision: number, hash: string }
interface Pending { id: string, revision: number, snapshot: CentralSnapshot, completion?: { id: string, result: unknown, error: string | null } }
export interface CentralExecutor {
  snapshot: () => Promise<CentralSnapshot>
  execute: (command: CentralCommand) => Promise<unknown>
  gate: (until: number) => Promise<void>
}
export type WorkspaceRequest = (body: Record<string, unknown>) => Promise<unknown>

export class CentralController {
  private lease = ''
  private state: State = { revision: 0, hash: '' }
  private online = false
  private operating = false
  private abort = new AbortController()
  private runner: Promise<void> | null = null
  private context = new AsyncLocalStorage<boolean>()
  private localActions = new Map<string, () => Promise<unknown>>()
  private uploaded = new Set<string>()
  private artifactCache: ArtifactCache = new Map()
  private publishing: Promise<void> | null = null
  error: string | null = null
  constructor(private readonly root: string, private readonly request: WorkspaceRequest, private readonly executor: CentralExecutor, private readonly helper: string) {}

  get executing(): boolean { return this.context.getStore() === true }
  get available(): boolean { return this.online }

  start(): void {
    if (!this.runner) this.runner = this.loop().finally(() => { this.runner = null })
  }

  private async read<T>(name: string): Promise<T | null> {
    try { return JSON.parse(await readFile(join(this.root, 'central', name), 'utf8')) as T }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }

  private async save(name: string, value: unknown): Promise<void> {
    await mkdir(join(this.root, 'central'), { recursive: true, mode: 0o700 })
    const directory = join(this.root, 'central')
    const staging = join(directory, `${name}.${randomUUID()}.pending`)
    try {
      await durableJSON(staging, value)
      await rename(staging, join(directory, name))
      await syncDirectory(directory)
    }
    finally { await rm(staging, { force: true }) }
  }

  private async call(body: Record<string, unknown>): Promise<unknown> { return this.request({ ...body, lease: this.lease }) }

  private async connect(): Promise<void> {
    const saved = await this.read<State>('state.json')
    const session = await this.request({ type: 'begin' }) as State & { lease: string, pending: CentralOperation[] }
    this.lease = session.lease
    const pending = await this.read<Pending>('publication.json')
    if (session.revision && !saved && !pending) throw new Error('Central data exists without its local adoption receipt; recover this same workspace before continuing')
    if (saved && session.hash !== saved.hash && !pending) throw new Error('Central state differs from the local receipt; explicit reconciliation is required')
    this.state = { revision: session.revision, hash: session.hash }
    const completion = await this.read<NonNullable<Pending['completion']>>('completion.json')
    if (pending) {
      await this.publish(pending)
    }
    else if (completion) {
      const operation = await this.call({ type: 'operation', id: completion.id }) as CentralOperation
      if (!['applied', 'failed'].includes(operation.state)) await this.synchronize(completion)
    }
    if (completion) await rm(join(this.root, 'central/completion.json'))
    if (session.pending.some(item => item.id !== (pending?.completion?.id ?? completion?.id))) throw new Error('A previous command has an uncertain outcome. Inspect its actual run and reconcile it before reconnecting')
    await this.synchronize()
    await this.heartbeat()
  }

  private async heartbeat(): Promise<void> {
    await this.publishing
    await this.call({ type: 'heartbeat', hash: this.state.hash })
    await this.executor.gate(this.operating ? 0 : Date.now() + 25000)
    this.online = true; this.error = null
  }

  private async synchronize(completion?: Pending['completion']): Promise<void> {
    const snapshot = parseCentralSnapshot(await this.executor.snapshot())
    const files = await managedArtifacts(this.root, snapshot, this.helper, this.artifactCache)
    snapshot.artifacts = files.map(({ content: _content, ...file }) => file)
    const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
    if (hash === this.state.hash && !completion) return
    for (const file of files) {
      const key = `${file.podId}:${file.hash}`
      if (!this.uploaded.has(key)) {
        if (file.content === undefined) throw new Error('Artifact upload data is missing')
        await this.call({ type: 'artifact', podId: file.podId, hash: file.hash, content: file.content })
        this.uploaded.add(key)
        delete file.content
      }
    }
    const pending: Pending = { id: randomUUID(), revision: this.state.revision, snapshot, ...(completion ? { completion } : {}) }
    await this.save('publication.json', pending)
    await this.publish(pending)
  }

  private async publish(pending: Pending): Promise<void> {
    this.publishing = (async () => {
      this.state = await this.call({ type: 'publish', ...pending }) as State
      await this.save('state.json', this.state)
      await rm(join(this.root, 'central/publication.json'))
    })()
    try { await this.publishing }
    finally { this.publishing = null }
  }

  private async operate(operation: CentralOperation): Promise<void> {
    this.operating = true; await this.executor.gate(0)
    await this.save('executing.json', { id: operation.id })
    let result: unknown = null; let error: string | null = null
    try {
      result = await this.context.run(true, async () => {
        if (operation.command.channel !== 'local') return this.executor.execute(operation.command)
        const action = this.localActions.get(operation.id)
        if (!action) throw new Error('Local action was interrupted; inspect the existing state before issuing another action')
        return action()
      })
    }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Workspace command failed' }
    const completion = { id: operation.id, result: result ?? null, error }
    await this.save('completion.json', completion)
    await this.synchronize(completion)
    await rm(join(this.root, 'central/completion.json'))
    await rm(join(this.root, 'central/executing.json'))
    this.operating = false
    await this.heartbeat()
  }

  private async loop(): Promise<void> {
    while (!this.abort.signal.aborted) {
      const renewal = new AbortController()
      let renew: Promise<void> | null = null
      try {
        await this.executor.gate(0)
        await this.connect()
        renew = (async () => {
          try {
            while (!renewal.signal.aborted) {
              await delay(10000, undefined, { signal: renewal.signal })
              await this.heartbeat()
            }
          }
          catch (error) {
            if (!renewal.signal.aborted) {
              this.online = false; this.error = String(error)
              await this.executor.gate(0)
            }
          }
        })()
        while (!this.abort.signal.aborted) {
          if (!this.online) throw new Error(this.error ?? 'Workspace connection lost')
          const operation = await this.call({ type: 'claim' }) as CentralOperation | null
          if (operation) await this.operate(operation)
          else await this.synchronize()
          await this.heartbeat()
          await delay(1000, undefined, { signal: this.abort.signal })
        }
      }
      catch (error) {
        this.online = false
        this.error = error instanceof Error ? error.message : 'Central workspace is unavailable'
        try { await this.executor.gate(0) }
        catch (failure) { this.error += `; ${String(failure)}` }
      }
      finally {
        renewal.abort(); await renew
        this.operating = false
      }
      if (this.abort.signal.aborted) break
      await delay(1000)
    }
  }

  async local<T>(action: () => Promise<T>): Promise<T> {
    if (this.executing) return action()
    if (!this.online) throw new Error(this.error ?? 'Central workspace is offline')
    const id = randomUUID()
    let localResult: T
    this.localActions.set(id, async () => { localResult = await action(); return { status: 'applied' } })
    try {
      await this.call({ type: 'submit', id, revision: this.state.revision, command: { channel: 'local', body: { type: 'ownerAction' } } })
      const deadline = Date.now() + 240000
      while (Date.now() < deadline && !this.abort.signal.aborted) {
        const operation = await this.call({ type: 'operation', id }) as CentralOperation
        if (operation.state === 'applied') return localResult!
        if (operation.state === 'failed' || operation.state === 'unknown') throw new Error(operation.error ?? 'Inspect the uncertain workspace operation')
        await delay(250, undefined, { signal: this.abort.signal })
      }
      throw new Error(`Workspace operation ${id} is not confirmed. Reconcile this operation before retrying`)
    }
    finally { this.localActions.delete(id) }
  }

  async query(body: Record<string, unknown>): Promise<unknown> {
    if (!['inventory', 'read', 'submit', 'operation'].includes(String(body.type))) throw new Error('Unsupported workspace query')
    return this.call(body)
  }

  async stop(): Promise<void> {
    this.abort.abort(); await this.runner
    if (this.lease) {
      try { await this.call({ type: 'disconnect' }) }
      catch (error) { console.error('Central disconnect failed; the server lease will expire', error) }
    }
    this.online = false; await this.executor.gate(0)
  }
}

export type DesktopCentralClient = Omit<CentralClient, 'changes'>
