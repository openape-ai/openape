import { describe, expect, it } from 'vitest'
import type { AgentEntry } from '../src/lib/registry'
import { resolveBridgeConfig } from '../src/lib/bridge-config'

function entry(over?: AgentEntry['bridge']): AgentEntry {
  return { name: 'backend', uid: 1000, home: '/home/backend', email: 'backend@example.test', registeredAt: 0, bridge: over }
}

describe('resolveBridgeConfig', () => {
  it('resolves the shared bridge config from the nest env', () => {
    const cfg = resolveBridgeConfig(entry(), {
      APE_CHAT_BRIDGE_MODEL: 'gpt-5.4',
      APE_CHAT_BRIDGE_TOOLS: 'bash, http',
      OPENAPE_TROOP_URL: 'https://troop.test/',
    })

    expect(cfg.model).toBe('gpt-5.4')
    expect(cfg.tools).toEqual(['bash', 'http'])
    expect(cfg.endpoint).toBe('https://troop.test')
  })

  it('lets the per-agent registry model override the shared env model', () => {
    const cfg = resolveBridgeConfig(entry({ model: 'claude-haiku-4-5' }), {
      APE_CHAT_BRIDGE_MODEL: 'gpt-5.4',
    })

    expect(cfg.model).toBe('claude-haiku-4-5')
  })

  it('throws when neither the env nor the entry supplies a model', () => {
    expect(() => resolveBridgeConfig(entry(), {})).toThrow(/APE_CHAT_BRIDGE_MODEL/)
  })

  it('does not mutate the supplied env when applying the override', () => {
    const env = { APE_CHAT_BRIDGE_MODEL: 'gpt-5.4' }
    resolveBridgeConfig(entry({ model: 'claude-haiku-4-5' }), env)

    expect(env.APE_CHAT_BRIDGE_MODEL).toBe('gpt-5.4')
  })
})
