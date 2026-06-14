import type { BridgeConfig } from './bridge-config'
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

describe('AgentSession.chatSocketUrl', () => {
  function session(endpoint: string): AgentSession {
    return new AgentSession(
      'agent@example.com',
      'owner@example.com',
      { endpoint } as BridgeConfig,
    )
  }

  it('rewrites https endpoints to wss and carries the token as a query param', () => {
    expect(session('https://troop.openape.ai').chatSocketUrl('tok-123'))
      .toBe('wss://troop.openape.ai/_ws/chat?token=tok-123')
  })

  it('rewrites plain http endpoints to ws', () => {
    expect(session('http://localhost:3010').chatSocketUrl('tok-123'))
      .toBe('ws://localhost:3010/_ws/chat?token=tok-123')
  })

  it('strips a leading Bearer prefix and url-encodes the token', () => {
    expect(session('https://troop.openape.ai').chatSocketUrl('Bearer a/b+c=d'))
      .toBe('wss://troop.openape.ai/_ws/chat?token=a%2Fb%2Bc%3Dd')
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
