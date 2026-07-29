import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { allowHookHit, hookAcceptsEvent, verifyHookSignature } from '../server/utils/cockpit/hook-auth'

describe('verifyHookSignature', () => {
  const secret = 'topsecret'
  const body = '{"event":"push"}'
  const digest = createHmac('sha256', secret).update(body).digest('hex')
  const sig = `sha256=${digest}`

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
  it.each(['X-Forgejo-Signature', 'X-Gitea-Signature'])('accepts the prefix-less %s value', () => {
    expect(verifyHookSignature(secret, body, digest, true)).toBe(true)
  })
  it('rejects a prefix-less signature on the legacy header', () => {
    expect(verifyHookSignature(secret, body, digest)).toBe(false)
  })
})

describe('hookAcceptsEvent', () => {
  it('accepts everything when no filter is set', () => {
    expect(hookAcceptsEvent('', 'push')).toBe(true)
    expect(hookAcceptsEvent(null, undefined)).toBe(true)
  })
  it('accepts a listed event', () => {
    expect(hookAcceptsEvent('issues', 'issues')).toBe(true)
    expect(hookAcceptsEvent('issues, pull_request', 'pull_request')).toBe(true)
  })
  it('rejects an unlisted event — the #1085 case: push on an issues-only hook', () => {
    expect(hookAcceptsEvent('issues', 'push')).toBe(false)
  })
  it('rejects when the sender names no event at all', () => {
    expect(hookAcceptsEvent('issues', undefined)).toBe(false)
    expect(hookAcceptsEvent('issues', '')).toBe(false)
  })
  it('ignores case and surrounding whitespace on both sides', () => {
    expect(hookAcceptsEvent(' Issues , push ', 'ISSUES')).toBe(true)
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
