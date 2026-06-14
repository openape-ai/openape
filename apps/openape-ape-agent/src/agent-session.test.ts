import type { BridgeConfig } from './bridge-config'
import { describe, expect, it } from 'vitest'
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

describe('AgentSession.parseChatFrame', () => {
  const session = new AgentSession(
    'agent@example.com',
    'owner@example.com',
    {} as BridgeConfig,
  )

  it('decodes a message frame from a JSON string', () => {
    const frame = JSON.stringify({
      type: 'message',
      chat_id: 'chat-1',
      payload: { id: 'm1', body: 'hi' },
    })
    expect(session.parseChatFrame(frame)).toEqual({
      chatId: 'chat-1',
      payload: { id: 'm1', body: 'hi' },
    })
  })

  it('decodes a message frame delivered as a Buffer', () => {
    const frame = Buffer.from(JSON.stringify({
      type: 'message',
      chat_id: 'chat-2',
      payload: { body: 'hi' },
    }))
    expect(session.parseChatFrame(frame)).toEqual({
      chatId: 'chat-2',
      payload: { body: 'hi' },
    })
  })

  it('defaults a missing chat_id to an empty string', () => {
    const frame = JSON.stringify({ type: 'message', payload: { body: 'hi' } })
    expect(session.parseChatFrame(frame)).toEqual({
      chatId: '',
      payload: { body: 'hi' },
    })
  })

  it('ignores non-message frame types', () => {
    const frame = JSON.stringify({ type: 'presence', payload: { online: true } })
    expect(session.parseChatFrame(frame)).toBeNull()
  })

  it('ignores message frames without a payload', () => {
    expect(session.parseChatFrame(JSON.stringify({ type: 'message' }))).toBeNull()
  })

  it('ignores invalid JSON and empty data', () => {
    expect(session.parseChatFrame('not json')).toBeNull()
    expect(session.parseChatFrame('')).toBeNull()
    expect(session.parseChatFrame(undefined)).toBeNull()
  })
})
