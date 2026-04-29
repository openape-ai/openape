import { readFileSync } from 'node:fs'
import { parse as parseTOML } from 'smol-toml'
import type { AgentConfig, MultiAgentProxyConfig, ProxyConfig } from './types.js'

export function loadConfig(path: string): ProxyConfig {
  const raw = readFileSync(path, 'utf-8')

  let parsed: Record<string, unknown>
  if (path.endsWith('.json')) {
    parsed = JSON.parse(raw)
  }
  else {
    parsed = parseTOML(raw) as Record<string, unknown>
  }

  const proxy = parsed.proxy as ProxyConfig['proxy']
  if (!proxy?.listen || !proxy?.idp_url || !proxy?.agent_email) {
    throw new Error('Config must have [proxy] with listen, idp_url, and agent_email')
  }

  proxy.default_action ??= 'block'

  return {
    proxy,
    allow: (parsed.allow ?? []) as ProxyConfig['allow'],
    deny: (parsed.deny ?? []) as ProxyConfig['deny'],
    grant_required: (parsed.grant_required ?? []) as ProxyConfig['grant_required'],
  }
}

/**
 * Load config as multi-agent format.
 * If the config has an `agents` array, use it directly.
 * Otherwise, convert single-agent format to multi-agent for backward-compat.
 */
export function loadMultiAgentConfig(path: string, overrides?: { mandatoryAuth?: boolean }): MultiAgentProxyConfig {
  const raw = readFileSync(path, 'utf-8')

  let parsed: Record<string, unknown>
  if (path.endsWith('.json')) {
    parsed = JSON.parse(raw)
  }
  else {
    parsed = parseTOML(raw) as Record<string, unknown>
  }

  const proxy = parsed.proxy as Record<string, unknown>
  if (!proxy?.listen) {
    throw new Error('Config must have [proxy] with listen')
  }

  const baseProxy: MultiAgentProxyConfig['proxy'] = {
    listen: proxy.listen as string,
    default_action: (proxy.default_action as MultiAgentProxyConfig['proxy']['default_action']) ?? 'block',
    mandatory_auth: overrides?.mandatoryAuth ?? (proxy.mandatory_auth as boolean | undefined),
  }

  // Multi-agent format: has agents array
  if (Array.isArray(parsed.agents)) {
    return {
      proxy: baseProxy,
      agents: parsed.agents as AgentConfig[],
    }
  }

  // Single-agent format: convert to multi-agent
  const idpUrl = proxy.idp_url as string
  const agentEmail = proxy.agent_email as string
  if (!idpUrl || !agentEmail) {
    throw new Error('Single-agent config requires proxy.idp_url and proxy.agent_email')
  }

  return {
    proxy: baseProxy,
    agents: [{
      email: agentEmail,
      idp_url: idpUrl,
      allow: (parsed.allow ?? []) as AgentConfig['allow'],
      deny: (parsed.deny ?? []) as AgentConfig['deny'],
      grant_required: (parsed.grant_required ?? []) as AgentConfig['grant_required'],
    }],
  }
}
