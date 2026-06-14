import type { BridgeConfig } from './bridge'
import { describe, expect, it, vi } from 'vitest'
import * as apes from '@openape/apes'
import { AgentSession } from './agent-session'

describe('AgentSession.describe', () => {
  it('formats agent and owner emails', () => {
    const session = new AgentSession(
      'agent@example.com',
      'owner@example.com',
      {} as BridgeConfig,
    )

    expect(session.describe()).toBe('agent@example.com (owner owner@example.com)')
  })
})

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

  it('materializes secrets into the returned env map', () => {
    const session = new AgentSession(
      'agent@example.com',
      'owner@example.com',
      {} as BridgeConfig,
    )

    const spy = vi.spyOn(apes, 'materializeSecrets').mockImplementation((opts) => {
      const env = opts?.env ?? {}
      env.OPENAPE_TEST_SECRET = 'value'
      return { applied: ['OPENAPE_TEST_SECRET'], failed: [] }
    })

    const env = session.secretsEnv()

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ env })
    expect(env.OPENAPE_TEST_SECRET).toBe('value')
    expect(process.env.OPENAPE_TEST_SECRET).toBeUndefined()

    spy.mockRestore()
  })
})
