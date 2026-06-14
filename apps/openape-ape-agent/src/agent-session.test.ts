import type { BridgeConfig } from './bridge'
import { describe, expect, it } from 'vitest'
import { AgentSession } from './agent-session'

describe('AgentSession.secretsEnv', () => {
  it('returns a fresh env map without mutating process.env', () => {
    delete process.env.OPENAPE_TEST_SECRET

    const session = new AgentSession(
      'agent@example.com',
      'owner@example.com',
      {} as BridgeConfig,
    )

    const env = session.secretsEnv()

    expect(env).toBeTypeOf('object')
    expect(env).not.toBe(process.env)
    expect(process.env.OPENAPE_TEST_SECRET).toBeUndefined()
  })
})
