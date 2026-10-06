import { describe, expect, it } from 'vitest'
import { identityFromClaims } from '../server/utils/git-identity'
import { parsePushLog } from '../server/utils/push-log'
import { createRateLimiter } from '../server/utils/rate-limit'

describe('identityFromClaims', () => {
  it('maps a direct human token', () => {
    expect(identityFromClaims({ sub: 'patrick@example.com', act: 'human' }))
      .toEqual({ email: 'patrick@example.com', act: 'human' })
  })

  it('maps a direct agent token', () => {
    expect(identityFromClaims({ sub: 'agent@example.com', act: 'agent' }))
      .toEqual({ email: 'agent@example.com', act: 'agent' })
  })

  it('treats a missing/unknown act as agent (fail closed)', () => {
    expect(identityFromClaims({ sub: 'x@example.com' })!.act).toBe('agent')
    expect(identityFromClaims({ sub: 'x@example.com', act: 'weird' })!.act).toBe('agent')
  })

  it('maps a delegated token to the ACTOR with the sub as delegator', () => {
    expect(identityFromClaims({ sub: 'patrick@example.com', act: { sub: 'agent@example.com' } }))
      .toEqual({ email: 'agent@example.com', act: 'agent', delegator: 'patrick@example.com' })
  })

  it('rejects tokens without a usable subject or actor', () => {
    expect(identityFromClaims({})).toBeNull()
    expect(identityFromClaims({ sub: 'p@example.com', act: { sub: '' } })).toBeNull()
  })

  it('maps a grant authz token (flat delegate claim) to the actor with a scope cap', () => {
    expect(identityFromClaims({
      sub: 'patrick@example.com',
      delegate: 'agent@example.com',
      scope: ['git:write'],
    })).toEqual({ email: 'agent@example.com', act: 'agent', delegator: 'patrick@example.com', cap: 'write' })
  })

  it('caps at the highest git:* scope and fails closed without one', () => {
    expect(identityFromClaims({ sub: 'p@example.com', scope: ['git:read', 'git:admin'] })!.cap).toBe('admin')
    expect(identityFromClaims({ sub: 'p@example.com', scope: ['mail:send'] })!.cap).toBe('none')
    expect(identityFromClaims({ sub: 'p@example.com' })!.cap).toBeUndefined()
  })
})

describe('createRateLimiter', () => {
  it('allows up to the limit per window and key, then denies', () => {
    let t = 0
    const limiter = createRateLimiter(2, 60, () => t)
    expect(limiter.hit('a')).toBe(true)
    expect(limiter.hit('a')).toBe(true)
    expect(limiter.hit('a')).toBe(false)
    expect(limiter.hit('b')).toBe(true)
    t += 60_000
    expect(limiter.hit('a')).toBe(true)
  })
})

describe('parsePushLog', () => {
  it('parses records, skips torn lines, later record wins', () => {
    const jsonl = [
      JSON.stringify({ sha: 'abc', email: 'a@example.com', act: 'human', ts: 1 }),
      '{"sha":"torn',
      JSON.stringify({ sha: 'abc', email: 'agent@example.com', act: 'agent', delegator: 'a@example.com', ts: 2 }),
    ].join('\n')
    const map = parsePushLog(jsonl)
    expect(map.size).toBe(1)
    expect(map.get('abc')).toEqual({ email: 'agent@example.com', act: 'agent', delegator: 'a@example.com', ts: 2 })
  })
})
