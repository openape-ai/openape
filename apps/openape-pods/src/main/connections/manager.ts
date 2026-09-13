import { randomUUID } from 'node:crypto'
import { rm, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ConnectionView, OnboardingCommand, OnboardingView } from '../../contracts/onboarding'
import type { AgentRuntime } from '../../worker/agent/executor'
import type { SetupInternal } from '../../worker/onboarding/control'
import type { CredentialCache } from './cache'
import { CodexConnection } from './codex'
import { OwnerConnection } from './owner'
import { MicrosoftConnection } from './microsoft'
import type { MailFolder } from './microsoft'
import { PodIdentityManager } from './agent'
import type { PodIdentityReference } from './agent'
import { approveMailGrants } from './grants'
import { recoverAuthDomains } from './ledger'
import { verifyExecutable } from '../../worker/runtime/sandbox'

interface SetupState { connections: ConnectionView[], complete: boolean }
export class ConnectionManager {
  private jobs = new Map<string, { controller: AbortController, work: Promise<void>, login: ConnectionView['login'] }>()
  private runtimeState = { ready: false, error: null as string | null }
  private assigning = false
  private providerSession = new AbortController()
  private codex: CodexConnection
  private owner: OwnerConnection
  private microsoft: MicrosoftConnection
  constructor(private readonly root: string, private readonly runtime: AgentRuntime, private readonly credentials: CredentialCache, private readonly dispatch: (command: SetupInternal) => Promise<unknown>, private readonly availability: () => Promise<void>) {
    this.codex = new CodexConnection(credentials, runtime, join(root, 'authentication'))
    this.owner = new OwnerConnection(credentials)
    this.microsoft = new MicrosoftConnection(credentials, runtime.helper, dirname(runtime.binary), join(root, 'authentication'))
  }

  async initialize(inspectCredentials: () => Promise<void>): Promise<void> {
    try {
      await recoverAuthDomains(join(this.root, 'authentication'), this.runtime.helper)
      await inspectCredentials()
      await rm(join(this.root, 'credentials/temporary'), { recursive: true, force: true })
      const manifest = JSON.parse(await readFile(this.runtime.manifest, 'utf8')) as { binaryHash: string, cli: string }
      if (manifest.cli !== `0.153.4-${process.platform}-${process.arch}`) throw new Error('Bundled Codex architecture does not match this Mac')
      await verifyExecutable(this.runtime.binary, manifest.binaryHash)
      const mail = JSON.parse(await readFile(join(dirname(this.runtime.binary), 'o365-manifest.json'), 'utf8')) as { binaryHash: string, platform: string, architecture: string }
      if (mail.platform !== process.platform || mail.architecture !== process.arch) throw new Error('Bundled mail tool architecture does not match this Mac')
      await verifyExecutable(join(dirname(this.runtime.binary), 'o365-cli'), mail.binaryHash)
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
    const { login: _login, ...record } = connection
    await this.dispatch({ type: 'save', connection: record, metadata })
  }

  async view(): Promise<OnboardingView> {
    const state = await this.state()
    return { ...state, connections: state.connections.map(item => ({ ...item, login: this.jobs.get(item.id)?.login ?? null })), runtime: this.runtimeState }
  }

  async execute(command: OnboardingCommand): Promise<OnboardingView> {
    if (command.type === 'list') return this.view()
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
    if (!this.runtimeState.ready) throw new Error(this.runtimeState.error ?? 'Bundled runtime is not ready')
    if (command.type === 'connect') {
      if (this.jobs.size >= 3) throw new Error('Finish or cancel another sign-in first')
      const id = randomUUID(); const connection: ConnectionView = { id, provider: command.provider, account: command.account, state: 'connecting', error: null, login: null }
      const metadata: Record<string, unknown> = command.issuer ? { issuer: command.issuer } : {}
      await this.credentials.create(id, '{}'); await this.save(connection, metadata)
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(new Error('Sign-in expired; start again')), 15 * 60 * 1000)
      const job = { controller, work: Promise.resolve(), login: null as ConnectionView['login'] }; this.jobs.set(id, job)
      job.work = (async () => {
        try {
          const present = (login: NonNullable<ConnectionView['login']>) => { job.login = login }
          if (command.provider === 'chatgpt') { const account = await this.codex.login(id, controller.signal, present); connection.account = account.account; metadata.accountId = account.accountId }
          if (command.provider === 'openape') Object.assign(metadata, await this.owner.login(id, command.issuer!.replace(/\/$/, ''), command.account, controller.signal, present))
          if (command.provider === 'microsoft') await this.microsoft.login(id, command.account, controller.signal, present)
          controller.signal.throwIfAborted(); await this.save({ ...connection, state: 'ready' }, metadata); await this.availability()
        }
        catch (error) { await this.save({ ...connection, state: 'failed', error: error instanceof Error ? error.message : 'Sign-in failed' }, metadata) }
        finally { clearTimeout(timer); this.jobs.delete(id) }
      })().catch((error: unknown) => { this.runtimeState = { ready: false, error: error instanceof Error ? error.message : 'Could not persist sign-in outcome' } })
      return this.view()
    }
    if (command.type === 'folders') {
      const item = await this.connection(command.id, 'microsoft'); if (item.state !== 'ready') throw new Error('Reconnect Microsoft before choosing folders')
      const folders = await this.microsoft.folders(item.id, item.account, AbortSignal.timeout(120000))
      await this.save(item, { ...await this.metadata(item.id), folders, foldersAt: Date.now() }); return this.view()
    }
    if (command.type === 'assign') {
      if (this.assigning) throw new Error('Another permission review is in progress')
      this.assigning = true
      try {
        const setup = command.setup; const owner = await this.connection(setup.ownerConnection, 'openape'); const mail = await this.connection(setup.mailConnection, 'microsoft')
        const metadata = await this.metadata(owner.id); const mailMetadata = await this.metadata(mail.id)
        const folders = mailMetadata.folders as MailFolder[] | undefined
        if (owner.state !== 'ready' || mail.state !== 'ready' || mail.account !== setup.account || typeof metadata.issuer !== 'string' || !Array.isArray(folders) || setup.folders.some(folder => !folders.some(known => known.id === folder.id && known.name === folder.name))) throw new Error('Review the current connected account and folder inventory')
        const identities = new PodIdentityManager(this.credentials)
        const pods = (metadata.pods ?? {}) as Record<string, { connectionId: string, prepared: boolean, identity?: PodIdentityReference }>
        let entry = pods[setup.podId]
        if (!entry) { entry = { connectionId: randomUUID(), prepared: false }; pods[setup.podId] = entry; metadata.pods = pods; await this.save(owner, metadata) }
        if (!entry.prepared) { await identities.ensurePrepared(entry.connectionId, setup.podId, metadata.issuer, owner.account); entry.prepared = true; await this.save(owner, metadata) }
        const signal = AbortSignal.timeout(120000)
        const bearer = await this.owner.bearer(owner.id, metadata.issuer, owner.account, signal)
        entry.identity = await identities.provision(entry.connectionId, `Pod ${setup.podId}`, bearer); await this.save(owner, metadata)
        const grants = await approveMailGrants(setup, entry.identity, identities, bearer, dirname(this.runtime.binary), signal)
        await this.dispatch({ type: 'assign', setup, identity: entry.identity, grants })
      }
      finally { this.assigning = false }
    }
    if (command.type === 'finish') await this.dispatch({ type: 'finish' })
    return this.view()
  }

  async folders(id: string): Promise<MailFolder[]> { return (await this.metadata(id)).folders as MailFolder[] ?? [] }

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
