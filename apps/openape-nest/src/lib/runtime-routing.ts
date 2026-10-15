import type { AgentEntry } from './registry'

export function isBridgeRuntime(agent: AgentEntry): boolean {
  return agent.runtimeType == null || agent.runtimeType === 'bridge'
}

export function assertBridgeRuntime(agent: AgentEntry): void {
  if (!isBridgeRuntime(agent)) {
    throw new Error(`Agent ${agent.name} uses unsupported runtime "${String(agent.runtimeType)}"; only bridge is supported. Retire or explicitly migrate its registry entry.`)
  }
}
