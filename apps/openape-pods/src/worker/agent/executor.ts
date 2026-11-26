import type { ProxyAgentRequest } from '../../contracts/agent'
import type { ScriptRuntime } from '../runs/runner'

/** `manifest` records the dependency lock hash of this build (`dist/runtime/manifest.json`). */
export interface AgentRuntime extends ScriptRuntime { manifest: string, validateProxyAgent?: (request: ProxyAgentRequest, signal: AbortSignal) => Promise<void> }
