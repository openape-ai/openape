import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { parseAgentRequest } from '../../contracts/agent'
import type { ProxyAgentRequest } from '../../contracts/agent'
import { AgentCallError, serializeSafeError } from '../../contracts/agent-errors'
import type { AgentPhase } from '../../contracts/agent-errors'
import { freezeAgentMetadata } from '../../contracts/agent-metadata'
import type { AgentCallMetadata } from '../../contracts/agent-metadata'
import type { AgentBackendStatus } from '../../contracts/agent-status'
import { configurationHash, parseAgentBackendConfig, resolveProxyRequest } from './config'
import { readPrivateJson, readProxyKey } from './private-file'
import { disableProxyConfiguration } from './disable-config'
import { requestProxy } from './transport'
import type { AgentBackendConfig } from './types'

export interface AgentBackendManagerOptions { profileRoot: string, fetch?: typeof fetch }
export interface ProxyRunOptions { signal?: AbortSignal, onMetadata?: (metadata: AgentCallMetadata) => void }
export interface ProxyRunResult { response: string, threadId: string, metadata: AgentCallMetadata }

export class AgentBackendManager {
  private readonly configPath: string
  private readonly paths = new Set<string>()
  private readonly fetcher: typeof fetch
  private config?: AgentBackendConfig
  private error?: AgentCallError
  private connection?: { baseUrl: string, keyFile: string }
  private disabled = false
  private initialized = false
  private readonly active = new Map<AbortController, Promise<void>>()
  private configurationWork = Promise.resolve()

  constructor(options: AgentBackendManagerOptions) {
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
    this.config = undefined
    this.error = undefined
    this.disabled = false
    try {
      const raw = await readPrivateJson(this.configPath, 'configuration')
      const config = parseAgentBackendConfig(raw)
      if (this.initialized && (!this.connection || this.connection.baseUrl !== config.proxy.baseUrl || this.connection.keyFile !== config.proxy.keyFile)) throw new AgentCallError('proxy_not_configured', 'Changing the proxy connection requires an idle runtime restart', { phase: 'resolve', cause: 'restart_required' })
      this.paths.add(config.proxy.keyFile)
      this.connection = { baseUrl: config.proxy.baseUrl, keyFile: config.proxy.keyFile }
      this.config = config
      if (config.proxy.enabled) await readProxyKey(config.proxy.keyFile, new AbortController().signal)
    }
    catch (error) {
      this.error = error instanceof AgentCallError ? error : new AgentCallError('proxy_not_configured', 'Proxy configuration could not be loaded', { phase: 'resolve' })
    }
    this.initialized = true
    return this.status()
  }

  status(): AgentBackendStatus {
    const config = this.config
    const mappings: AgentBackendStatus['mappings'] = []
    if (config) {
      for (const provider of ['claude', 'codex'] as const) {
        for (const [modelSize, entry] of Object.entries(config.proxy.models[provider])) mappings.push({ provider, modelSize: modelSize as AgentBackendStatus['mappings'][number]['modelSize'], modelId: entry.modelId, enabled: entry.enabled, defaultThinking: entry.defaultThinking, thinking: Object.entries(entry.thinking).filter(([, policy]) => policy.enabled).map(([level]) => level as AgentBackendStatus['mappings'][number]['defaultThinking']), capabilityEvidenceVersion: entry.capabilityEvidenceVersion })
      }
    }
    const enabled = !!config?.proxy.enabled && !this.disabled
    return { configured: !!config, enabled, available: enabled && !this.error && mappings.some(mapping => mapping.enabled && mapping.thinking.length), ...(config ? { revision: config.revision, hash: configurationHash(config) } : {}), ...(this.error ? { error: serializeSafeError(this.error) } : {}), mappings }
  }

  private async abortActive(): Promise<void> {
    this.disabled = true
    for (const controller of this.active.keys()) controller.abort(new AgentCallError('cancelled', 'Proxy agent backend was disabled', { phase: 'request', cause: 'backend_disabled' }))
    await Promise.all([...this.active.values()])
  }

  async disable(): Promise<void> { return this.changeConfiguration(() => this.disableConfiguration()) }

  private async disableConfiguration(): Promise<void> {
    await this.abortActive()
    if (this.config) {
      await disableProxyConfiguration(this.configPath, configurationHash(this.config))
      this.config = parseAgentBackendConfig({ ...this.config, proxy: { ...this.config.proxy, enabled: false } })
      this.error = undefined
    }
  }

  async drain(): Promise<void> { await this.abortActive() }

  validate(input: ProxyAgentRequest): void {
    const request = parseAgentRequest(input)
    if (request.backend !== 'proxy') throw new AgentCallError('invalid_request', 'The proxy backend accepts only proxy requests', { phase: 'resolve' })
    if (this.disabled || !this.config) throw new AgentCallError('proxy_not_configured', 'Proxy agent backend is disabled or not configured', { phase: 'resolve' })
    if (this.error) throw new AgentCallError(this.error.code, this.error.message, { ...this.error.details })
    resolveProxyRequest(this.config, request)
  }

  async run(input: ProxyAgentRequest, options: ProxyRunOptions = {}): Promise<ProxyRunResult> {
    const request = parseAgentRequest(input)
    if (request.backend !== 'proxy') throw new AgentCallError('invalid_request', 'The proxy backend accepts only proxy requests', { phase: 'resolve' })
    const started = Date.now(); const callId = randomUUID(); const threadId = `proxy-call:${callId}`
    let metadata: AgentCallMetadata = { callId, backend: 'proxy', provider: request.provider, modelSize: request.modelSize, modelId: null, reportedModelId: null, requestedThinking: request.thinking ?? null, effectiveThinking: null, wireThinking: null, configRevision: null, configHash: null, modelSelection: 'explicit-mapping', startedAt: new Date(started).toISOString(), endedAt: null, durationMs: null, status: 'running', threadId }
    const controller = new AbortController(); let phase: AgentPhase = 'resolve'
    let resolveDrain: () => void = () => undefined
    this.active.set(controller, new Promise<void>((resolve) => { resolveDrain = resolve }))
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
      const snapshot = resolveProxyRequest(this.config, request)
      metadata = freezeAgentMetadata({ ...metadata, modelId: snapshot.model.modelId, effectiveThinking: snapshot.effectiveThinking, wireThinking: snapshot.wireThinking })
      options.onMetadata?.(metadata)
      const key = await readProxyKey(snapshot.keyFile, controller.signal)
      if (this.error?.code === 'credential_unavailable') this.error = undefined
      phase = 'connect'
      const reply = await requestProxy(snapshot, request, key, controller.signal, this.fetcher, (reportedModelId, upstreamId) => { metadata = { ...metadata, reportedModelId, ...(upstreamId ? { upstreamId } : {}) } }, (value) => { phase = value })
      controller.signal.throwIfAborted()
      metadata = freezeAgentMetadata({ ...metadata, ...('usage' in reply ? { usage: reply.usage } : {}), endedAt: new Date().toISOString(), durationMs: Date.now() - started, status: 'completed' })
      options.onMetadata?.(metadata)
      return { response: reply.response, threadId, metadata }
    }
    catch (failure) {
      const error = controller.signal.aborted && controller.signal.reason instanceof AgentCallError ? controller.signal.reason : failure instanceof AgentCallError ? failure : new AgentCallError('provider_error', 'Proxy agent call failed', { phase })
      metadata = freezeAgentMetadata({ ...metadata, endedAt: new Date().toISOString(), durationMs: Date.now() - started, status: error.code === 'cancelled' ? 'cancelled' : error.code === 'timeout' ? 'timeout' : 'failed', error: serializeSafeError(error) })
      error.metadata = metadata
      if (error.code === 'credential_unavailable' && this.config && configurationHash(this.config) === metadata.configHash) this.error = new AgentCallError(error.code, error.message, { ...error.details })
      options.onMetadata?.(metadata)
      throw error
    }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); this.active.delete(controller); resolveDrain() }
  }
}
