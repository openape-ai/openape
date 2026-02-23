import { readFileSync } from 'node:fs'
import { parse as parseTOML } from 'smol-toml'
import type { ProxyConfig } from './types.js'

export function loadConfig(path: string): ProxyConfig {
  const raw = readFileSync(path, 'utf-8')

  let parsed: Record<string, unknown>
  if (path.endsWith('.json')) {
    parsed = JSON.parse(raw)
  } else {
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
