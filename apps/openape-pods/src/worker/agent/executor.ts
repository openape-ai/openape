import type { ProxyAgentRequest } from '../../contracts/agent'
import type { ScriptRuntime } from '../runs/runner'

export interface AgentRuntime extends ScriptRuntime { binary: string, catalog: string, manifest: string, sdkHost: string, validateProxyAgent?: (request: ProxyAgentRequest, signal: AbortSignal) => Promise<void> }
