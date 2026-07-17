import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { allowHookHit, verifyHookSignature } from '../server/utils/cockpit/hook-auth'

describe('verifyHookSignature', () => {
  const secret = 'topsecret'
  const body = '{"event":"push"}'
  const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

  it('accepts a correct signature', () => {
    expect(verifyHookSignature(secret, body, sig)).toBe(true)
  })
  it('rejects a wrong signature', () => {
    expect(verifyHookSignature(secret, body, 'sha256=deadbeef')).toBe(false)
  })
  it('rejects a tampered body', () => {
    expect(verifyHookSignature(secret, '{"event":"pwn"}', sig)).toBe(false)
  })
  it('rejects a missing header', () => {
    expect(verifyHookSignature(secret, body, undefined)).toBe(false)
  })
  it('rejects the wrong secret', () => {
    expect(verifyHookSignature('other', body, sig)).toBe(false)
  })
})

describe('allowHookHit', () => {
  it('allows up to the limit then blocks within the window', () => {
    const t = 'tok-a'
    const now = 1_000_000
    for (let i = 0; i < 3; i++) expect(allowHookHit(t, now, 3, 60_000)).toBe(true)
    expect(allowHookHit(t, now, 3, 60_000)).toBe(false)
  })
  it('resets after the window elapses', () => {
    const t = 'tok-b'
    const now = 2_000_000
    expect(allowHookHit(t, now, 1, 60_000)).toBe(true)
    expect(allowHookHit(t, now, 1, 60_000)).toBe(false)
    expect(allowHookHit(t, now + 60_001, 1, 60_000)).toBe(true)
  })
  it('tracks tokens independently', () => {
    const now = 3_000_000
    expect(allowHookHit('x', now, 1, 60_000)).toBe(true)
    expect(allowHookHit('x', now, 1, 60_000)).toBe(false)
    expect(allowHookHit('y', now, 1, 60_000)).toBe(true)
  })
})
