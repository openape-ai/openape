import { describe, expect, it, vi, afterEach } from 'vitest'
import { isTokenExpired } from '../../src/idp/auth.js'
import type { AgentAuthState } from '../../src/idp/auth.js'

describe('isTokenExpired', () => {
  it('returns false for fresh token', () => {
    const state: AgentAuthState = {
      idpUrl: 'https://id.openape.at',
      token: 'test-token',
      email: 'agent@openape.at',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }
    expect(isTokenExpired(state)).toBe(false)
  })

  it('returns true for expired token', () => {
    const state: AgentAuthState = {
      idpUrl: 'https://id.openape.at',
      token: 'test-token',
      email: 'agent@openape.at',
      expiresAt: Math.floor(Date.now() / 1000) - 60,
    }
    expect(isTokenExpired(state)).toBe(true)
  })

  it('returns true when within 30s buffer', () => {
    const state: AgentAuthState = {
      idpUrl: 'https://id.openape.at',
      token: 'test-token',
      email: 'agent@openape.at',
      expiresAt: Math.floor(Date.now() / 1000) + 20, // 20s left, but 30s buffer
    }
    expect(isTokenExpired(state)).toBe(true)
  })
})
