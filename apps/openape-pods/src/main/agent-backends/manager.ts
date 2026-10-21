import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { parseAgentRequest } from '../../contracts/agent'
import type { ProxyAgentRequest } from '../../contracts/agent'
import { AgentCallError, serializeSafeError, safeSystemCause } from '../../contracts/agent-errors'
import type { AgentPhase } from '../../contracts/agent-errors'
import { freezeAgentMetadata } from '../../contracts/agent-metadata'
import type { AgentCallMetadata } from '../../contracts/agent-metadata'
import type { AgentBackendStatus } from '../../contracts/agent-status'
import { configurationHash } from './config'
import { defaultModelApiConfig, parseModelApiConfig, providerConnection, resolveLatestRequest, validateModelSelection } from './model-config'
import { readModelCatalog } from './catalog'
import { latestModel, modelFamilies } from './families'
import { assertPrivatePath, credentialPath, modelSecretDirectory, readConnectionKey, saveModelApiSettings } from './settings-store'
import { modelApiIds } from '../../contracts/model-api'
import type { ModelApiId, ModelApiSave } from '../../contracts/model-api'
import { readPrivateJson } from './private-file'
import { requestProxy } from './transport'
import type { ModelApiConfig, ModelCatalog } from './types'

export interface AgentBackendManagerOptions { profileRoot: string, fetch?: typeof fetch }
export interface ProxyRunOptions { signal?: AbortSignal, onMetadata?: (metadata: AgentCallMetadata) => void }
export interface ProxyRunResult { response: string, threadId: string, metadata: AgentCallMetadata }

export class AgentBackendManager {
  private readonly configPath: string
  private readonly paths = new Set<string>()
  private readonly fetcher: typeof fetch
  private config?: ModelApiConfig
  private readonly root: string
  private readonly catalog = new Map<ModelApiId, ModelCatalog>()
  private readonly connectionErrors = new Map<ModelApiId, AgentCallError>()
  private readonly restart = new Set<ModelApiId>()
  private error?: AgentCallError
  private connections?: ModelApiConfig['connections']
  private disabled = false
  private initialized = false
  private readonly active = new Map<AbortController, { done: Promise<void>, connectionId: ModelApiId }>()
  private configurationWork = Promise.resolve()

  constructor(options: AgentBackendManagerOptions) {
    this.root = options.profileRoot
    this.paths.add(modelSecretDirectory(this.root))
    this.configPath = join(options.profileRoot, 'agent-backends.json')
    this.paths.add(this.configPath)
    this.fetcher = options.fetch ?? fetch
  }

  protectedPaths(): string[] { return [...this.paths] }

  private async changeConfiguration<T>(change: () => Promise<T>): Promise<T> {
    const previous = this.configurationWork
    let release: () => void = () => undefined
    this.configurationWork = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await change() }
    finally { release() }
  }

  async reload(): Promise<AgentBackendStatus> { return this.changeConfiguration(() => this.loadConfiguration()) }

  private async loadConfiguration(): Promise<AgentBackendStatus> {
    this.config = undefined; this.error = undefined; this.disabled = false
    this.catalog.clear(); this.connectionErrors.clear(); this.restart.clear()
    try {
      const raw = await readPrivateJson(this.configPath, 'configuration')
      await assertPrivatePath(this.configPath)
      const config = parseModelApiConfig(raw)
      for (const id of modelApiIds) {
        const connection = config.connections[id]; const previous = this.connections?.[id]
        const path = credentialPath(this.root, connection)
        const changedProtection = path && !this.paths.has(path) && connection.credential?.type === 'external'
        if (this.initialized && ((!previous && connection.enabled) || previous?.baseUrl !== connection.baseUrl || changedProtection)) {
          this.restart.add(id)
          this.connectionErrors.set(id, new AgentCallError('proxy_not_configured', 'Changing the API connection requires an idle runtime restart', { phase: 'resolve', cause: 'restart_required' }))
          await this.abortActive(id)
          continue
        }
        if (path && connection.credential?.type === 'external') this.paths.add(path)
        if (!connection.enabled) await this.abortActive(id)
        if (connection.enabled) {
          try { await readConnectionKey(this.root, connection, new AbortController().signal) }
          catch (error) { this.connectionErrors.set(id, error instanceof AgentCallError ? error : new AgentCallError('credential_unavailable', 'API credential could not be read', { phase: 'resolve', cause: safeSystemCause(error) })) }
        }
      }
      if (!this.initialized) this.connections = structuredClone(config.connections)
      this.config = config
    }
    catch (error) {
      this.error = error instanceof AgentCallError ? error : new AgentCallError('proxy_not_configured', 'Model API configuration could not be loaded', { phase: 'resolve' })
      await this.abortActive()
    }
    this.initialized = true
    return this.status()
  }

  status(): AgentBackendStatus {
    const config = this.config
    const shown = config ?? defaultModelApiConfig()
    const mappings: AgentBackendStatus['mappings'] = []
    for (const provider of ['claude', 'codex'] as const) {
      const id = providerConnection[provider]
      for (const [modelSize, entry] of Object.entries(shown.models[provider])) {
        let modelId = ''; let resolutionError: AgentBackendStatus['error']
        const catalog = this.catalog.get(id)
        if (catalog && shown.connections[id].enabled && entry.enabled) {
          try { modelId = resolveLatestRequest(shown, { backend: 'proxy', provider, modelSize: modelSize as 'small', prompt: '', tools: [], timeoutSeconds: 120 }, catalog).model.modelId }
          catch (error) { resolutionError = serializeSafeError(error instanceof AgentCallError ? error : new AgentCallError('model_unavailable', 'Latest model could not be resolved', { phase: 'resolve' })) }
        }
        mappings.push({ ...(resolutionError ? { error: resolutionError } : {}), provider, modelSize: modelSize as AgentBackendStatus['mappings'][number]['modelSize'], modelId: modelId || modelFamilies[provider][modelSize as 'small'], enabled: entry.enabled, defaultThinking: entry.defaultThinking, thinking: Object.entries(entry.thinking).filter(([, policy]) => policy.enabled).map(([level]) => level as AgentBackendStatus['mappings'][number]['defaultThinking']), capabilityEvidenceVersion: entry.capabilityEvidenceVersion })
      }
    }
    const enabled = !!config && modelApiIds.some(id => config.connections[id].enabled) && !this.disabled
    return {
      configured: !!config,
      enabled,
      available: enabled && !this.error && mappings.some(mapping => mapping.enabled && mapping.thinking.length && !mapping.error && config?.connections[providerConnection[mapping.provider]].enabled && !this.connectionErrors.has(providerConnection[mapping.provider])),
      ...(config ? { revision: config.revision, hash: configurationHash(config) } : {}),
      ...(this.error ? { error: serializeSafeError(this.error) } : {}),
      mappings,
      connections: modelApiIds.map((id) => {
        const { credential, ...settings } = shown.connections[id]
        const error = this.connectionErrors.get(id)
        return { ...settings, hasToken: !!credential, ...(this.restart.has(id) ? { restartRequired: true } : {}), ...(this.catalog.has(id) ? { checkedAt: this.catalog.get(id)?.checkedAt } : {}), ...(error ? { error: serializeSafeError(error) } : {}) }
      }),
    }
  }

  private async abortActive(id?: ModelApiId): Promise<void> {
    if (!id) this.disabled = true
    const work = [...this.active.entries()].filter(([, item]) => !id || item.connectionId === id)
    for (const [controller] of work) controller.abort(new AgentCallError('cancelled', 'Model API connection was disabled', { phase: 'request', cause: 'backend_disabled' }))
    await Promise.all(work.map(([, item]) => item.done))
  }

  async save(input: ModelApiSave): Promise<AgentBackendStatus> {
    return this.changeConfiguration(async () => { await saveModelApiSettings(this.root, input); return this.loadConfiguration() })
  }

  async check(id: ModelApiId): Promise<AgentBackendStatus> {
    if (!this.config) throw new AgentCallError('proxy_not_configured', 'Save model API settings before checking', { phase: 'resolve' })
    const config = this.config; const connection = config.connections[id]
    if (this.restart.has(id)) return this.status()
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(new AgentCallError('timeout', 'Catalog check timed out', { phase: 'resolve' })), 10000)
    let finish: () => void = () => undefined
    this.active.set(controller, { connectionId: id, done: new Promise<void>((resolve) => { finish = resolve }) })
    try {
      const key = await readConnectionKey(this.root, connection, controller.signal)
      const catalog = await readModelCatalog(connection, key, controller.signal, this.fetcher)
      if (this.config === config) { this.catalog.set(id, catalog); this.connectionErrors.delete(id) }
    }
    catch (error) { if (this.config === config) this.connectionErrors.set(id, error instanceof AgentCallError ? error : new AgentCallError('proxy_unreachable', 'Catalog check failed', { phase: 'resolve' })) }
    finally { clearTimeout(timer); this.active.delete(controller); finish() }
    return this.status()
  }

  async disable(): Promise<void> {
    await this.changeConfiguration(async () => {
      await this.abortActive()
      const config = this.config
      if (!config) return
      const connections = Object.fromEntries(modelApiIds.map((id) => { const { credential: _credential, id: _id, ...settings } = config.connections[id]; return [id, { ...settings, enabled: false }] })) as ModelApiSave['connections']
      await saveModelApiSettings(this.root, { expectedHash: configurationHash(config), connections })
      await this.loadConfiguration()
    })
  }

  async drain(): Promise<void> { await this.abortActive() }

  validate(input: ProxyAgentRequest): void {
    const request = parseAgentRequest(input)
    if (request.backend !== 'proxy') throw new AgentCallError('invalid_request', 'The proxy backend accepts only proxy requests', { phase: 'resolve' })
    if (this.disabled || !this.config) throw new AgentCallError('proxy_not_configured', 'Proxy agent backend is disabled or not configured', { phase: 'resolve' })
    if (this.error) throw new AgentCallError(this.error.code, this.error.message, { ...this.error.details })
    const error = this.connectionErrors.get(providerConnection[request.provider])
    if (this.restart.has(providerConnection[request.provider]) && error) throw new AgentCallError(error.code, error.message, { ...error.details })
    validateModelSelection(this.config, request)
  }

  async run(input: ProxyAgentRequest, options: ProxyRunOptions = {}): Promise<ProxyRunResult> {
    const request = parseAgentRequest(input)
    if (request.backend !== 'proxy') throw new AgentCallError('invalid_request', 'The proxy backend accepts only proxy requests', { phase: 'resolve' })
    const started = Date.now(); const callId = randomUUID(); const threadId = `proxy-call:${callId}`
    let metadata: AgentCallMetadata = { callId, backend: 'proxy', provider: request.provider, modelSize: request.modelSize, modelId: null, reportedModelId: null, requestedThinking: request.thinking ?? null, effectiveThinking: null, wireThinking: null, configRevision: null, configHash: null, modelSelection: 'latest-family', connectionId: providerConnection[request.provider], resolverVersion: '1', startedAt: new Date(started).toISOString(), endedAt: null, durationMs: null, status: 'running', threadId }
    const controller = new AbortController(); let phase: AgentPhase = 'resolve'
    let resolveDrain: () => void = () => undefined
    this.active.set(controller, { connectionId: providerConnection[request.provider], done: new Promise<void>((resolve) => { resolveDrain = resolve }) })
    const cancel = () => controller.abort(new AgentCallError('cancelled', 'Proxy agent call was cancelled', { phase }))
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) cancel()
    const timer = setTimeout(() => controller.abort(new AgentCallError('timeout', 'Proxy agent call timed out', { phase })), request.timeoutSeconds * 1000)
    try {
      controller.signal.throwIfAborted()
      if (this.disabled) throw new AgentCallError('proxy_not_configured', 'Proxy agent backend is disabled', { phase })
      if (this.error && this.error.code !== 'credential_unavailable') throw new AgentCallError(this.error.code, this.error.message, { ...this.error.details })
      if (!this.config) throw new AgentCallError('proxy_not_configured', 'Proxy agent backend is not configured', { phase })
      metadata = { ...metadata, configRevision: this.config.revision, configHash: configurationHash(this.config) }
      const config = this.config; const connection = config.connections[providerConnection[request.provider]]
      if (this.restart.has(connection.id)) throw new AgentCallError('proxy_not_configured', 'Changing the API connection requires an idle runtime restart', { phase: 'resolve', cause: 'restart_required' })
      validateModelSelection(config, request)
      metadata = { ...metadata, apiFormat: connection.format }
      const key = await readConnectionKey(this.root, connection, controller.signal)
      const catalog = await readModelCatalog(connection, key, controller.signal, this.fetcher)
      const selected = latestModel(catalog.entries, request.provider, request.modelSize)
      metadata = { ...metadata, modelId: selected.entry.id, modelFamily: selected.family, modelVersion: selected.version, catalogHash: catalog.hash, catalogCheckedAt: catalog.checkedAt }
      const snapshot = resolveLatestRequest(config, request, catalog)
      metadata = freezeAgentMetadata({ ...metadata, apiFormat: connection.format, modelId: snapshot.model.modelId, effectiveThinking: snapshot.effectiveThinking, wireThinking: snapshot.wireThinking, modelFamily: snapshot.family, modelVersion: snapshot.version, catalogHash: catalog.hash, catalogCheckedAt: catalog.checkedAt })
      options.onMetadata?.(metadata)
      if (this.config === config) { this.catalog.set(connection.id, catalog); this.connectionErrors.delete(connection.id) }
      phase = 'connect'
      const reply = await requestProxy(snapshot, request, key ?? '', controller.signal, this.fetcher, (reportedModelId, upstreamId) => { metadata = { ...metadata, reportedModelId, ...(upstreamId ? { upstreamId } : {}) } }, (value) => { phase = value })
      controller.signal.throwIfAborted()
      metadata = freezeAgentMetadata({ ...metadata, ...('usage' in reply ? { usage: reply.usage } : {}), endedAt: new Date().toISOString(), durationMs: Date.now() - started, status: 'completed' })
      options.onMetadata?.(metadata)
      return { response: reply.response, threadId, metadata }
    }
    catch (failure) {
      const error = controller.signal.aborted && controller.signal.reason instanceof AgentCallError ? controller.signal.reason : failure instanceof AgentCallError ? failure : new AgentCallError('provider_error', 'Proxy agent call failed', { phase })
      metadata = freezeAgentMetadata({ ...metadata, endedAt: new Date().toISOString(), durationMs: Date.now() - started, status: error.code === 'cancelled' ? 'cancelled' : error.code === 'timeout' ? 'timeout' : 'failed', error: serializeSafeError(error) })
      error.metadata = metadata
      if (error.code === 'credential_unavailable' && this.config && configurationHash(this.config) === metadata.configHash) this.connectionErrors.set(providerConnection[request.provider], new AgentCallError(error.code, error.message, { ...error.details }))
      options.onMetadata?.(metadata)
      throw error
    }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); this.active.delete(controller); resolveDrain() }
  }
}
