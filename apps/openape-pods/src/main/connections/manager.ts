import type { Owner } from '@openape/pods-protocol'
import { enablePodBroker, revokePodBroker, podBrokerReceipt } from './broker'
import type { PodBrokerConnection } from './broker'
import { loadAdapter, resolveCommand } from '@openape/apes'
import type { ProgramAssignment } from '../../contracts/programs'
import { randomUUID } from 'node:crypto'
import { rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConnectionView, OnboardingCommand, OnboardingView, PodIdentityView } from '../../contracts/onboarding'
import type { AgentRuntime } from '../../worker/agent/executor'
import type { SetupInternal } from '../../worker/onboarding/control'
import type { CredentialCache } from './cache'
import { CodexConnection } from './codex'
import { OwnerConnection } from './owner'
import { PodIdentityManager } from './agent'
import type { PodIdentityReference } from './agent'
import { recoverAuthDomains } from './ledger'
import { verifyExecutable } from '../../worker/runtime/sandbox'
import { approveCommands } from '../programs/grants'
import type { ProgramAuthority } from '../programs/grants'

interface SetupState { connections: ConnectionView[], defaultOwner: string | null, complete: boolean }
export class ConnectionManager {
  private jobs = new Map<string, { controller: AbortController, work: Promise<void>, login: ConnectionView['login'], owner: boolean }>()
  private runtimeState = { ready: false, error: null as string | null }
  private assigning = false
  private identityTurn: Promise<void> = Promise.resolve()
  private providerSession = new AbortController()
  private codex: CodexConnection
  private owner: OwnerConnection
  constructor(private readonly root: string, private readonly runtime: AgentRuntime, private readonly credentials: CredentialCache, private readonly dispatch: (command: SetupInternal) => Promise<unknown>, private readonly availability: () => Promise<void>) {
    this.codex = new CodexConnection(credentials, runtime, join(root, 'authentication'))
    this.owner = new OwnerConnection(credentials)
  }

  async initialize(inspectCredentials: () => Promise<void>): Promise<void> {
    try {
      await recoverAuthDomains(join(this.root, 'authentication'), this.runtime.helper)
      await inspectCredentials()
      await rm(join(this.root, 'credentials/temporary'), { recursive: true, force: true })
      const manifest = JSON.parse(await readFile(this.runtime.manifest, 'utf8')) as { binaryHash: string, cli: string }
      if (manifest.cli !== `0.153.4-${process.platform}-${process.arch}`) throw new Error('Bundled Codex architecture does not match this Mac')
      await verifyExecutable(this.runtime.binary, manifest.binaryHash)
      this.runtimeState = { ready: true, error: null }; await this.availability()
    }
    catch (error) { this.runtimeState = { ready: false, error: error instanceof Error ? error.message : 'Runtime inspection failed' } }
  }

  private async state(): Promise<SetupState> { return await this.dispatch({ type: 'list' }) as SetupState }
  private async metadata(id: string): Promise<Record<string, unknown>> { return await this.dispatch({ type: 'metadata', id }) as Record<string, unknown> }
  private async connection(id: string, provider?: ConnectionView['provider']): Promise<ConnectionView> {
    const item = (await this.state()).connections.find(item => item.id === id)
    if (!item || (provider && item.provider !== provider)) throw new Error('Connection is unavailable')
    return item
  }

  private async save(connection: ConnectionView, metadata: Record<string, unknown>): Promise<void> {
    const { login: _login, broker: _broker, ...record } = connection
    await this.dispatch({ type: 'save', connection: record, metadata })
  }

  private async podIdentity(state: SetupState, podId: string): Promise<PodIdentityView> {
    const owners = state.connections.filter(item => item.provider === 'openape')
    const candidates = await Promise.all(owners.map(async owner => ({ owner, metadata: await this.metadata(owner.id) })))
    const bound = candidates.filter(item => Object.hasOwn((item.metadata.pods ?? {}) as object, podId))
    if (bound.length > 1) throw new Error('This pod is assigned to multiple OpenApe accounts; correct its owner before continuing')
    const selected = bound[0] ?? candidates.find(item => item.owner.id === state.defaultOwner)
    if (!selected) return { podId, bound: false, ownerConnection: null, issuer: null, decisionIssuer: null, subject: null, brokerConnectionId: null }
    const { owner, metadata } = selected
    const entry = (metadata.pods as Record<string, { broker?: PodBrokerConnection, identity?: PodIdentityReference }> | undefined)?.[podId]
    const broker = entry ? entry.broker : metadata.broker as PodBrokerConnection | undefined
    const decisionIssuer = entry?.identity?.decisionIssuer ?? (typeof metadata.issuer === 'string' ? metadata.issuer : null)
    return { podId, bound: !!entry, ownerConnection: owner.id, issuer: entry?.identity?.issuer ?? broker?.issuer ?? decisionIssuer, decisionIssuer, subject: entry?.identity?.subject ?? null, brokerConnectionId: entry?.identity?.brokerConnectionId ?? broker?.connectionId ?? null }
  }

  async existingRemotePods(owner: Owner): Promise<{ podId: string, identity: PodIdentityReference }[]> {
    const state = await this.state()
    const owners = state.connections.filter(item => item.provider === 'openape')
    const entries = await Promise.all(owners.map(async connection => ({ connection, metadata: await this.metadata(connection.id) })))
    const seen = new Set<string>(); const bound: { podId: string, identity: PodIdentityReference }[] = []
    for (const entry of entries) {
      const pods = (entry.metadata.pods ?? {}) as Record<string, { identity?: PodIdentityReference }>
      for (const [podId, pod] of Object.entries(pods)) {
        if (seen.has(podId)) throw new Error('This pod is assigned to multiple OpenApe accounts; correct its owner before continuing')
        seen.add(podId)
        if (entry.metadata.issuer !== owner.issuer || entry.metadata.subject !== owner.subject || !pod.identity) continue
        if (pod.identity.podId !== podId || pod.identity.owner !== owner.subject || (pod.identity.decisionIssuer ?? pod.identity.issuer) !== owner.issuer) throw new Error('Existing pod identity belongs to a different setup')
        bound.push({ podId, identity: pod.identity })
      }
    }
    return bound
  }

  async remoteOwner(): Promise<Owner> {
    const state = await this.state()
    const selected = state.connections.find(item => item.id === state.defaultOwner && item.provider === 'openape' && item.state === 'ready')
    if (!selected) throw new Error('Connect and select your OpenApe owner account on desktop first')
    const metadata = await this.metadata(selected.id)
    if (typeof metadata.issuer !== 'string' || typeof metadata.subject !== 'string') throw new Error('Reconnect your owner account to verify its identity')
    return { issuer: metadata.issuer, subject: metadata.subject }
  }

  async view(podId?: string): Promise<OnboardingView> {
    const state = await this.state()
    const connections = await Promise.all(state.connections.map(async (item) => {
      const metadata = item.provider === 'openape' ? await this.metadata(item.id) : {}
      return { ...item, ...(metadata.broker ? { broker: metadata.broker as PodBrokerConnection } : {}), login: this.jobs.get(item.id)?.login ?? null }
    }))
    return { ...state, connections, runtime: this.runtimeState, ...(podId ? { podIdentity: await this.podIdentity(state, podId) } : {}) }
  }

  async execute(command: OnboardingCommand): Promise<OnboardingView> {
    if (command.type === 'list') return this.view(command.podId)
    if (command.type === 'assign' || command.type === 'folders' || (command.type === 'connect' && command.provider === 'microsoft')) throw new Error('Configure application accounts in the pod Permissions tab')
    if (command.type === 'cancel' || command.type === 'disconnect') {
      const job = this.jobs.get(command.id); job?.controller.abort(new Error('Sign-in cancelled by the owner')); await job?.work
      if (command.type === 'disconnect') {
        const item = await this.connection(command.id)
        if (item.provider === 'chatgpt') { this.providerSession.abort(new Error('ChatGPT connection removed')); this.providerSession = new AbortController() }
        await this.dispatch({ type: 'revoke', id: item.id }); await this.save({ ...item, state: 'revoked', error: null }, await this.metadata(item.id))
        await this.availability()
      }
      return this.view()
    }
    if (command.type === 'enableBroker' || command.type === 'revokeBroker') { await this.configureBroker(command); return this.view() }
    if (command.type === 'setDefaultOwner') { await this.dispatch({ type: 'setDefaultOwner', id: command.id }); return this.view() }
    if (!this.runtimeState.ready) throw new Error(this.runtimeState.error ?? 'Bundled runtime is not ready')
    if (command.type === 'connect') {
      const connection: ConnectionView = { id: randomUUID(), provider: command.provider, account: command.account, state: 'connecting', error: null, login: null }
      return this.startLogin(connection, command.issuer ? { issuer: command.issuer.replace(/\/$/, '') } : {}, command.makeDefault === true, true)
    }
    if (command.type === 'reconnect') {
      const connection = await this.connection(command.id, 'openape')
      if (this.assigning) throw new Error('Another permission review is in progress')
      return this.startLogin({ ...connection, state: 'connecting', error: null }, await this.metadata(connection.id), false)
    }
    if (command.type === 'finish') await this.dispatch({ type: 'finish' })
    return this.view()
  }

  private async configureBroker(command: Extract<OnboardingCommand, { type: 'enableBroker' | 'revokeBroker' }>): Promise<void> {
    if (this.assigning) throw new Error('Another permission review is in progress')
    this.assigning = true
    try {
      const owner = await this.connection(command.id, 'openape')
      if (owner.state !== 'ready') throw new Error('Sign in before authorizing an agent provider')
      const metadata = await this.metadata(owner.id)
      if (typeof metadata.issuer !== 'string') throw new Error('Owner identity provider is missing')
      const signal = AbortSignal.timeout(120000)
      const bearer = await this.owner.bearer(owner.id, metadata.issuer, owner.account, signal)
      if (command.type === 'enableBroker') {
        if (metadata.broker) throw new Error('Revoke the current agent provider before connecting another')
        metadata.broker = await enablePodBroker(metadata.issuer, owner.account, command.issuer, command.domain, bearer, signal)
      }
      else {
        if (!metadata.broker) throw new Error('No agent provider is connected')
        await revokePodBroker(metadata.issuer, metadata.broker as PodBrokerConnection, bearer, signal)
        delete metadata.broker
      }
      await this.save(owner, metadata)
    }
    finally { this.assigning = false }
  }

  private async startLogin(connection: ConnectionView, metadata: Record<string, unknown>, makeDefault: boolean, fresh = false): Promise<OnboardingView> {
    if (this.jobs.size >= 3 || this.jobs.has(connection.id)) throw new Error('Finish or cancel another sign-in first')
    if (connection.provider === 'openape' && [...this.jobs.values()].some(job => job.owner)) throw new Error('Finish or cancel another sign-in first')
    if (fresh) await this.credentials.create(connection.id, '{}')
    await this.save(connection, metadata)
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(new Error('Sign-in expired; start again')), 15 * 60 * 1000)
    const job = { controller, work: Promise.resolve(), login: null as ConnectionView['login'], owner: connection.provider === 'openape' }; this.jobs.set(connection.id, job)
    job.work = (async () => {
      try {
        const present = (login: NonNullable<ConnectionView['login']>) => { job.login = login }
        if (connection.provider === 'chatgpt') { const account = await this.codex.login(connection.id, controller.signal, present); connection.account = account.account; metadata.accountId = account.accountId }
        if (connection.provider === 'openape') {
          if (typeof metadata.issuer !== 'string') throw new Error('OpenApe identity provider is required')
          Object.assign(metadata, await this.owner.login(connection.id, metadata.issuer.replace(/\/$/, ''), connection.account, controller.signal, present))
        }
        controller.signal.throwIfAborted(); await this.save({ ...connection, state: 'ready' }, metadata)
        if (makeDefault) await this.dispatch({ type: 'setDefaultOwner', id: connection.id })
        await this.availability()
      }
      catch (error) { await this.save({ ...connection, state: 'failed', error: error instanceof Error ? error.message : 'Sign-in failed' }, metadata) }
      finally { clearTimeout(timer); this.jobs.delete(connection.id) }
    })().catch((error: unknown) => { this.runtimeState = { ready: false, error: error instanceof Error ? error.message : 'Could not persist sign-in outcome' } })
    return this.view()
  }

  async podConnection(podId: string, requestedOwner?: Owner) {
    const previous = this.identityTurn
    let release!: () => void
    this.identityTurn = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      if (this.assigning) throw new Error('Another permission review is in progress')
      this.assigning = true
      try { return await this.preparePodConnection(podId, requestedOwner) }
      finally { this.assigning = false }
    }
    finally { release() }
  }

  private async preparePodConnection(podId: string, requestedOwner?: Owner) {
    const state = await this.state()
    const owners = state.connections.filter(item => item.provider === 'openape')
    const candidates = await Promise.all(owners.map(async owner => ({ owner, metadata: await this.metadata(owner.id) })))
    const bound = candidates.filter(item => Object.hasOwn((item.metadata.pods ?? {}) as object, podId))
    if (bound.length > 1) throw new Error('This pod is assigned to multiple OpenApe accounts; correct its owner before continuing')
    const matches = (item: typeof candidates[number]) => item.metadata.issuer === requestedOwner?.issuer && (item.metadata.subject ?? item.owner.account) === requestedOwner?.subject
    if (requestedOwner && bound.length && !matches(bound[0])) throw new Error('Pod belongs to another owner')
    const selected = bound[0] ?? candidates.find(item => requestedOwner ? matches(item) : item.owner.id === state.defaultOwner)
    if (!selected) throw new Error('Choose a default OpenApe account before setting up a new pod')
    if (selected.owner.state !== 'ready') throw new Error('Reconnect this pod’s OpenApe account before continuing')
    const { owner, metadata } = selected
    if (typeof metadata.issuer !== 'string') throw new Error('OpenApe identity provider is required')
    const identities = new PodIdentityManager(this.credentials)
    const pods = (metadata.pods ?? {}) as Record<string, { connectionId: string, prepared: boolean, broker?: PodBrokerConnection, identity?: PodIdentityReference }>
    let entry = pods[podId]
    if (!entry) { entry = { connectionId: randomUUID(), prepared: false, ...(metadata.broker ? { broker: metadata.broker as PodBrokerConnection } : {}) }; pods[podId] = entry; metadata.pods = pods; await this.save(owner, metadata) }
    if (!entry.prepared) { await identities.ensurePrepared(entry.connectionId, podId, entry.broker?.issuer ?? metadata.issuer, owner.account, entry.broker ? { decisionIssuer: metadata.issuer, brokerConnectionId: entry.broker.connectionId } : undefined); entry.prepared = true; await this.save(owner, metadata) }
    if (!entry.identity) {
      const bearer = await this.owner.bearer(owner.id, metadata.issuer, owner.account, AbortSignal.timeout(120000))
      const receipt = entry.broker ? await podBrokerReceipt(metadata.issuer, entry.broker, bearer, AbortSignal.timeout(10000)) : undefined
      entry.identity = await identities.provision(entry.connectionId, `Pod ${podId}`, bearer, receipt); await this.save(owner, metadata)
    }
    return { ...identities.connection(entry.identity, `pods:${podId}`), identity: entry.identity, ownerConnection: owner.id }
  }

  async existingProgramGrant(podId: string, assignment: ProgramAssignment, argv: string[]) {
    await verifyExecutable(assignment.adapterPath, assignment.adapterHash)
    const resolved = await resolveCommand(loadAdapter(assignment.cliId, assignment.adapterPath), [assignment.cliId, ...argv])
    const existing = assignment.grants.find(grant => grant.permission === resolved.permission)
    if (existing) return existing
    const connection = await this.podConnection(podId)
    return { permission: resolved.permission, display: resolved.detail.display, authority: { identity: connection.identity, ownerConnection: connection.ownerConnection, grantId: '' } }
  }

  async approve(podId: string, adapterPath: string, commands: string[][]): Promise<ProgramAuthority> {
    const connection = await this.podConnection(podId)
    if (this.assigning) throw new Error('Another permission review is in progress')
    this.assigning = true
    try {
      const signal = AbortSignal.timeout(120000)
      const bearer = await this.owner.bearer(connection.ownerConnection, connection.decisionIssuer ?? connection.issuer, connection.owner, signal)
      const grantId = await approveCommands(connection.identity, new PodIdentityManager(this.credentials), bearer, adapterPath, commands, signal)
      return { identity: connection.identity, ownerConnection: connection.ownerConnection, grantId }
    }
    finally { this.assigning = false }
  }

  busy(): boolean { return this.jobs.size > 0 || this.assigning }
  async purgePodKeys(podId: string, assignedIds: string[]): Promise<void> {
    const ids = new Set(assignedIds)
    const owners = (await this.state()).connections.filter(item => item.provider === 'openape')
    for (const owner of owners) {
      const metadata = await this.metadata(owner.id); const pods = metadata.pods as Record<string, { connectionId?: string }> | undefined
      const id = pods?.[podId]?.connectionId
      if (id) ids.add(id)
    }
    for (const id of ids) await this.credentials.erasePodKey(id, podId)
    for (const owner of owners) {
      const metadata = await this.metadata(owner.id); const pods = metadata.pods as Record<string, unknown> | undefined
      if (pods && Object.hasOwn(pods, podId)) { delete pods[podId]; await this.save(owner, metadata) }
    }
  }

  async providerReady(): Promise<boolean> { return this.runtimeState.ready && (await this.state()).connections.some(item => item.provider === 'chatgpt' && item.state === 'ready') }
  async provider(body: unknown, signal: AbortSignal): Promise<Response> {
    signal = AbortSignal.any([signal, this.providerSession.signal])
    const item = (await this.state()).connections.find(item => item.provider === 'chatgpt' && item.state === 'ready')
    if (!this.runtimeState.ready || !item) throw new Error('Connect ChatGPT before running the model')
    const metadata = await this.metadata(item.id)
    if (typeof metadata.accountId !== 'string') throw new Error('ChatGPT account binding is missing')
    const bearer = await this.codex.bearer(item.id, metadata.accountId, signal)
    const response = await fetch('https://chatgpt.com/backend-api/codex/responses', { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${bearer}`, 'ChatGPT-Account-ID': metadata.accountId, 'Content-Type': 'application/json', Accept: 'text/event-stream', originator: 'codex_cli_rs' }, body: JSON.stringify(body), signal })
    if ([401, 403].includes(response.status)) { await this.save({ ...item, state: 'expired', error: 'ChatGPT sign-in expired or access was denied; reconnect' }, metadata); await this.availability() }
    return response
  }

  async stop(): Promise<void> { this.providerSession.abort(); for (const job of this.jobs.values()) job.controller.abort(); await Promise.all(Array.from(this.jobs.values(), job => job.work)) }
}
