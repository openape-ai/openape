import example from './agent-backends-legacy.json'
import { parseAgentBackendConfig } from '../../src/main/agent-backends/config'
import type { AgentBackendConfig } from '../../src/main/agent-backends/types'

export function approvedAgentBackendConfig(keyFile: string, baseUrl = 'http://127.0.0.1:8317/v1'): AgentBackendConfig {
  const config = structuredClone(example)
  // Synthetic fixtures exercise candidate serialization even when real acceptance keeps it disabled.
  for (const entry of Object.values(config.proxy.models.claude)) entry.enabled = true
  return parseAgentBackendConfig({ ...config, proxy: { ...config.proxy, enabled: true, keyFile, baseUrl } })
}
