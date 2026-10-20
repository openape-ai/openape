import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { CentralClient, CentralCommand, CentralOperation, CentralRuntime, CentralSnapshot, CentralState, CentralStatus, UncertainOperation } from '../../contracts/central'
import { canonicalJson } from '../../contracts/canonical-json'
import { centralHeartbeatMs, parseCentralSnapshot } from '../../contracts/central'
import { encodeParts, manifestDigest, splitSnapshot } from '../../contracts/central-parts'
import type { CentralManifest } from '../../contracts/central-parts'
import { durableJSON, syncPath } from '../../worker/data/files'

interface State { revision: number, hash: string }
interface Completion { id: string, result: unknown, error: string | null }
interface Pending { id: string, revision: number, completion?: Completion, format: 2, hash: string, changes: Record<string, string | null>, parts: Record<string, unknown> }
interface Session extends State { lease: string, pending: CentralOperation[], format?: number, runtimeId?: string, manifest?: CentralManifest }
export interface CentralGate { lastTickAt: number, tickingSince: number | null, tickPhase?: string | null, tickTimeout?: { phase: string, at: number } | null }
export interface CentralExecutor {
  snapshot: () => Promise<CentralSnapshot>
  version?: () => Promise<number>
  execute: (command: CentralCommand, operationId: string) => Promise<unknown>
  gate: (until: number) => Promise<CentralGate | void>
}
export type WorkspaceRequest = (body: Record<string, unknown>) => Promise<unknown>
/** Busy or moved-revision refusals of a submit; the service created no operation for them. */
function refusedWithoutOperation(error: unknown): boolean {
  const { status, code } = error as { status?: unknown, code?: unknown }
  return status === 409 && (code === 'workspace_busy' || code === 'workspace_revision_conflict')
}
function operationConflict(error: unknown): boolean {
  const { status, code } = error as { status?: unknown, code?: unknown }
  return status === 409 && code === 'workspace_operation_conflict'
}
const submitAttempts = 10
export const reconnectingMs = 2 * 60000
export const offlineAlertMs = 5 * 60000
const batchBytes = 2 * 1024 * 1024

export function centralState(online: boolean, lastOnlineAt: number | null, since: number, now: number): CentralState {
  if (online) return 'online'
  if (lastOnlineAt === null) return 'connecting'
  return now - since < reconnectingMs ? 'reconnecting' : 'offline'
}

export function offlineAlert(status: Pick<CentralStatus, 'state' | 'since'>, alerted: boolean, now: number): 'alert' | 'recovered' | null {
  if (status.state === 'online') return alerted ? 'recovered' : null
  return !alerted && now - status.since >= offlineAlertMs ? 'alert' : null
}

export function partBatches(parts: Record<string, unknown>, maximum = batchBytes): Record<string, unknown>[] {
  const batches: Record<string, unknown>[] = []; let current: Record<string, unknown> = {}; let size = 0
  for (const [hash, value] of Object.entries(parts)) {
    const bytes = JSON.stringify(value).length
    if (size && size + bytes > maximum) { batches.push(current); current = {}; size = 0 }
    current[hash] = value; size += bytes
  }
  if (size) batches.push(current)
  return batches
}

class ConnectionLost extends Error {}

export function uncertainOperation(operation: CentralOperation, executing: string | null): UncertainOperation {
  const body = operation.command.body as Record<string, unknown>
  return { id: operation.id, channel: operation.command.channel, type: typeof body?.type === 'string' ? body.type : null, podId: typeof body?.podId === 'string' ? body.podId : null, error: operation.error, startedLocally: executing === operation.id }
}

export class CentralController {
  private lease = ''
  private state: State = { revision: 0, hash: '' }
  private localQueue: Promise<void> = Promise.resolve()
  private online = false
  private operating = false
  private abort = new AbortController()
  private runner: Promise<void> | null = null
  private context = new AsyncLocalStorage<boolean>()
  private localActions = new Map<string, () => Promise<unknown>>()
  private publishing: Promise<void> | null = null
  private publicationQueue: Promise<void> = Promise.resolve()
  private background: Promise<void> | null = null
  private backgroundError: unknown = null
  private generation = 0
  private wake: (() => void) | null = null
  private format: 2 | null = null
  private manifest: CentralManifest = {}
  private runtimeId: string | null = null
  private phase = 'worker gate'
  private since = Date.now()
  private lastOnlineAt: number | null = null
  private gateUntil = 0
  private worker: CentralGate | null = null
  private lastPublication: CentralStatus['lastPublication'] = null
  private publishedAt = 0
  private cached: { version: number, snapshot: CentralSnapshot, hash: string } | null = null
  private uncertain: UncertainOperation[] = []
  error: string | null = null
  constructor(private readonly root: string, private readonly request: WorkspaceRequest, private readonly executor: CentralExecutor, private readonly timing: { heartbeatMs: number, publishIntervalMs: number, submitRetryMs?: number } = { heartbeatMs: centralHeartbeatMs, publishIntervalMs: 5000 }) {}

  get executing(): boolean { return this.context.getStore() === true }
  get available(): boolean { return this.online }
  offlineMessage(): string { return `Central workspace offline: ${this.error ?? 'connecting'}` }

  status(): CentralStatus {
    return { state: centralState(this.online, this.lastOnlineAt, this.since, Date.now()), error: this.error, since: this.since, lastOnlineAt: this.lastOnlineAt, gateUntil: this.gateUntil, lastTickAt: this.worker?.lastTickAt || null, tickingSince: this.worker?.tickingSince ?? null, tickPhase: this.worker?.tickPhase ?? null, tickTimeout: this.worker?.tickTimeout ?? null, format: this.format, runtimeId: this.runtimeId, lastPublication: this.lastPublication, uncertain: this.uncertain }
  }

  start(): void {
    if (!this.runner) this.runner = this.loop().finally(() => { this.runner = null })
  }

  private offline(error: string): void {
    if (this.online) this.since = Date.now()
    this.online = false; this.error = error
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
      await syncPath(directory)
    }
    finally { await rm(staging, { force: true }) }
  }

  private async call(body: Record<string, unknown>): Promise<unknown> { return this.request({ ...body, lease: this.lease }) }
  private async gate(until: number): Promise<void> {
    this.worker = await this.executor.gate(until) ?? this.worker
    this.gateUntil = until
  }

  private async connect(): Promise<void> {
    const saved = await this.read<State>('state.json')
    this.phase = 'begin'
    const session = await this.request({ type: 'begin' }) as Session
    this.lease = session.lease
    this.cached = null; this.publishedAt = 0
    if (session.format !== 2) throw new Error('The central service predates this desktop; update the service before connecting')
    this.format = 2
    this.manifest = session.manifest ?? {}
    this.runtimeId = session.runtimeId ?? null
    this.phase = 'reconcile'
    const pending = await this.read<Pending>('publication.json')
    if (session.revision && !saved && !pending) throw new Error('Central data exists without its local adoption receipt; recover this same workspace before continuing')
    if (saved && session.hash !== saved.hash && !pending) throw new Error('Central state differs from the local receipt; explicit reconciliation is required')
    this.state = { revision: session.revision, hash: session.hash }
    const completion = await this.read<Completion>('completion.json')
    if (pending && pending.format !== 2) {
      // A full-snapshot journal of a desktop before issue 1455 (M8) cannot apply; publish its outcome again.
      await rm(join(this.root, 'central/publication.json'))
      if (pending.completion) await this.synchronize(pending.completion)
    }
    else if (pending) {
      try { await this.publish(pending) }
      catch (error) {
        // A refused format-2 delta never committed; rebuild it from the current state instead of retrying forever.
        if ((error as { status?: number }).status !== 409) throw error
        await rm(join(this.root, 'central/publication.json'))
        this.manifest = session.manifest ?? {}
        await this.synchronize(pending.completion)
      }
    }
    else if (completion) {
      const operation = await this.call({ type: 'operation', id: completion.id }) as CentralOperation
      if (!['applied', 'failed'].includes(operation.state)) await this.synchronize(completion)
    }
    if (completion) await rm(join(this.root, 'central/completion.json'))
    const executing = (await this.read<{ id: string }>('executing.json'))?.id ?? null
    this.uncertain = session.pending.filter(item => item.id !== (pending?.completion?.id ?? completion?.id)).map(item => uncertainOperation(item, executing))
    // executing.json is saved before any command runs, so an uncertain command without it never started here.
    const unstarted = this.uncertain.find(item => !item.startedLocally)
    if (unstarted) {
      await this.save('completion.json', { id: unstarted.id, result: null, error: 'Not executed: the desktop lost its connection before the command started. Submit it again.' })
      throw new Error('Settling a command that never started on this desktop')
    }
    if (this.uncertain.length) throw new Error('A previous command has an uncertain outcome. Inspect its actual run and reconcile it before reconnecting')
    await this.synchronize()
    this.phase = 'heartbeat'
    await this.heartbeat()
  }

  // Never waits for a publication: the service accepts the replaced hash.
  private async heartbeat(): Promise<void> {
    await this.call({ type: 'heartbeat', hash: this.state.hash })
    await this.gate(this.operating ? 0 : Date.now() + 25000)
    if (!this.online) this.since = Date.now()
    this.online = true; this.error = null; this.lastOnlineAt = Date.now()
  }

  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = this.publicationQueue.then(action)
    this.publicationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async pause(): Promise<void> {
    const controller = new AbortController()
    this.wake = () => controller.abort()
    try { await delay(1000, undefined, { signal: AbortSignal.any([controller.signal, this.abort.signal]) }) }
    catch (error) { if (!controller.signal.aborted && !this.abort.signal.aborted) throw error }
    finally { this.wake = null }
  }

  private async synchronize(completion?: Completion): Promise<void> {
    if (!completion && Date.now() - this.publishedAt < this.timing.publishIntervalMs) return
    const generation = this.generation
    this.phase = 'worker snapshot'
    const version = await this.executor.version?.()
    const reuse = !completion && version !== undefined && this.cached?.version === version
    let base: CentralSnapshot
    try { base = reuse ? this.cached!.snapshot : parseCentralSnapshot(await this.executor.snapshot()) }
    catch (error) {
      if (!completion && this.online && error instanceof Error && error.message === 'Workspace changed during central projection; retry the snapshot') return
      throw error
    }
    if (!completion && generation !== this.generation) return
    const snapshot = { ...base, artifacts: [] }
    if (reuse && this.cached!.hash === this.state.hash) { this.publishedAt = Date.now(); return }
    const parts = encodeParts(splitSnapshot(snapshot))
    const manifest = Object.fromEntries(Array.from(parts, ([key, part]) => [key, part.hash]))
    const hash = manifestDigest(manifest)
    if (version !== undefined) this.cached = { version, snapshot, hash }
    if (hash === this.state.hash && !completion) { this.publishedAt = Date.now(); return }
    const changes: Record<string, string | null> = Object.fromEntries(Object.keys(this.manifest).filter(key => !(key in manifest)).map(key => [key, null]))
    const uploads: Record<string, unknown> = {}
    for (const [key, part] of parts) {
      if (this.manifest[key] === part.hash) continue
      changes[key] = part.hash; uploads[part.hash] = JSON.parse(part.text)
    }
    const pending: Pending = { id: randomUUID(), revision: this.state.revision, ...(completion ? { completion } : {}), format: 2, hash, changes, parts: uploads }
    const batches = partBatches(pending.parts)
    const at = Date.now()
    for (const parts of batches) {
      if (!completion && generation !== this.generation) return
      await this.call({ type: 'parts', parts })
    }
    await this.serialized(async () => {
      if (!completion && (generation !== this.generation || this.operating)) return
      await this.save('publication.json', pending)
      await this.publish(pending, { at, batches })
    })
  }

  private async publish(pending: Pending, staged?: { at: number, batches: Record<string, unknown>[] }): Promise<void> {
    this.publishing = (async () => {
      const at = staged?.at ?? Date.now()
      this.phase = 'part upload'
      const batches = staged?.batches ?? partBatches(pending.parts)
      if (!staged) {
        for (const parts of batches) await this.call({ type: 'parts', parts })
      }
      this.phase = 'publish'
      const { parts: _parts, format: _format, ...publication } = pending
      this.state = await this.call({ type: 'publish', format: 2, ...publication }) as State
      this.manifest = { ...this.manifest }
      for (const [key, hash] of Object.entries(pending.changes)) { if (hash === null) delete this.manifest[key]; else this.manifest[key] = hash }
      const bytes = batches.reduce((total, batch) => total + JSON.stringify(batch).length, JSON.stringify(publication).length)
      await this.save('state.json', this.state)
      await rm(join(this.root, 'central/publication.json'))
      this.lastPublication = { at, bytes }; this.publishedAt = Date.now()
    })()
    try { await this.publishing }
    finally { this.publishing = null }
  }

  private async operate(operation: CentralOperation): Promise<void> {
    this.operating = true
    this.phase = 'worker gate'; await this.gate(0)
    await this.save('executing.json', { id: operation.id })
    let result: unknown = null; let error: string | null = null
    this.phase = 'execute'
    try {
      result = await this.context.run(true, async () => {
        if (operation.command.channel !== 'local') return this.executor.execute(operation.command, operation.id)
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
    this.phase = 'heartbeat'
    await this.heartbeat()
  }

  private async loop(): Promise<void> {
    while (!this.abort.signal.aborted) {
      const renewal = new AbortController()
      let renew: Promise<void> | null = null
      try {
        this.phase = 'worker gate'
        await this.gate(0)
        await this.connect()
        renew = (async () => {
          try {
            while (!renewal.signal.aborted) {
              await delay(this.timing.heartbeatMs, undefined, { signal: renewal.signal })
              await this.heartbeat()
            }
          }
          catch (error) {
            if (!renewal.signal.aborted) {
              this.offline(`heartbeat: ${error instanceof Error ? error.message : String(error)}`)
              await this.gate(0)
            }
          }
        })()
        while (!this.abort.signal.aborted) {
          if (!this.online) throw new ConnectionLost()
          if (this.backgroundError) { const error = this.backgroundError; this.backgroundError = null; throw error }
          this.phase = 'claim'
          const operation = await this.serialized(async () => {
            const claimed = await this.call({ type: 'claim' }) as CentralOperation | null
            if (claimed) { this.operating = true; this.generation++; this.cached = null }
            return claimed
          })
          if (operation) {
            await this.operate(operation)
          }
          else if (!this.background) {
            this.background = this.synchronize().catch((error: unknown) => { this.backgroundError = error }).finally(() => { this.background = null })
          }
          await this.pause()
        }
      }
      catch (error) {
        if (!(error instanceof ConnectionLost)) this.offline(`${this.phase}: ${error instanceof Error ? error.message : 'Central workspace is unavailable'}`)
        try { await this.gate(0) }
        catch (failure) { this.error += `; ${String(failure)}` }
      }
      finally {
        renewal.abort(); await renew
        this.generation++; await this.background; this.backgroundError = null
        this.operating = false
      }
      if (this.abort.signal.aborted) break
      await delay(1000)
    }
  }

  /**
   * Owner actions on this desktop run one at a time through the workspace, so
   * they never collide with each other. The service accepts one operation per
   * runtime and only at the current revision; both refusals create no
   * operation, so the same id is submitted again until the deadline.
   */
  async local<T>(action: () => Promise<T>): Promise<T> {
    if (this.executing) return action()
    const queued = this.localQueue.then(() => this.submitLocal(action))
    this.localQueue = queued.then(() => undefined, () => undefined)
    return queued
  }

  private async submitLocal<T>(action: () => Promise<T>): Promise<T> {
    if (!this.online) throw new Error(this.offlineMessage())
    const id = randomUUID()
    let localResult: T
    this.localActions.set(id, async () => { localResult = await action(); return { status: 'applied' } })
    const deadline = Date.now() + 240000
    try {
      for (;;) {
        try {
          await this.call({ type: 'submit', id, revision: this.state.revision, command: { channel: 'local', body: { type: 'ownerAction' } } })
          this.wake?.()
          break
        }
        catch (error) {
          if (!refusedWithoutOperation(error) || Date.now() >= deadline || this.abort.signal.aborted) throw error
          await delay(250, undefined, { signal: this.abort.signal })
        }
      }
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

  /**
   * Records the owner's reconciliation of an uncertain command as its completion. The next connection
   * publishes it, so the service settles the operation without the command running again.
   */
  async reconcile(id: string, applied: boolean, evidence: string): Promise<{ id: string, applied: boolean, state: 'recorded' }> {
    if (!this.uncertain.some(item => item.id === id)) throw new Error('This command is not an uncertain operation of this desktop')
    if (await this.read('completion.json')) throw new Error('Another completion is waiting for publication; retry after it is published')
    await this.save('completion.json', { id, result: { reconciled: true, applied, evidence }, error: applied ? null : `Reconciled as not applied: ${evidence}` })
    return { id, applied, state: 'recorded' }
  }

  // Inventory carries this desktop's own connection status, which the service cannot know.
  async query(body: Record<string, unknown>): Promise<unknown> {
    if (!['inventory', 'read', 'submit', 'operation', 'changes'].includes(String(body.type))) throw new Error('Unsupported workspace query')
    if (!this.lease) throw new Error(this.offlineMessage())
    if (body.type === 'submit') return this.submit(body)
    const result = await this.call(body)
    if (body.type !== 'inventory' || !Array.isArray(result)) return result
    return result.map((runtime: { id?: unknown }) => runtime.id === this.runtimeId ? { ...runtime, desktop: this.status() } : runtime)
  }

  /**
   * A runtime publishes a new revision every few seconds, so a submit at a revision read a moment earlier
   * is often refused. Both refusals create no operation and commands are idempotent by id: the identical
   * command is submitted again at the runtime's current revision, a bounded number of times.
   */
  private async submit(body: Record<string, unknown>): Promise<unknown> {
    let revision = body.revision
    for (let attempt = 1; ; attempt++) {
      try { return await this.call({ ...body, revision }) }
      catch (error) {
        if (operationConflict(error)) return this.acceptedAtAnotherRevision(body, error)
        if (!refusedWithoutOperation(error) || attempt >= submitAttempts) throw error
        await delay(this.timing.submitRetryMs ?? 1000, undefined, { signal: this.abort.signal })
        revision = await this.runtimeRevision(String(body.runtimeId))
      }
    }
  }

  /** A resubmitted command may have been accepted at a later revision than the caller read; the identical command keeps that receipt. */
  private async acceptedAtAnotherRevision(body: Record<string, unknown>, conflict: unknown): Promise<CentralOperation> {
    let operation: CentralOperation
    try { operation = await this.call({ type: 'operation', id: body.id }) as CentralOperation }
    catch { throw conflict }
    if (operation.runtimeId !== body.runtimeId || canonicalJson(operation.command) !== canonicalJson(body.command)) throw conflict
    return operation
  }

  private async runtimeRevision(runtimeId: string): Promise<number> {
    const runtimes = await this.call({ type: 'inventory' }) as CentralRuntime[]
    const runtime = runtimes.find(item => item.id === runtimeId)
    if (!runtime) throw new Error('This runtime is no longer in the workspace inventory')
    return runtime.revision
  }

  async stop(): Promise<void> {
    this.abort.abort(); await this.runner
    if (this.lease) {
      try { await this.call({ type: 'disconnect' }) }
      catch (error) { console.error('Central disconnect failed; the server lease will expire', error) }
    }
    this.online = false; await this.gate(0)
  }
}

export type DesktopCentralClient = Omit<CentralClient, 'changes'>
