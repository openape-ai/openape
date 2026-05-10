import { describe, expect, it } from 'vitest'
import { _clampBodyForTest as clamp } from '../src/chat-api'

describe('chat-api body clamp', () => {
  it('returns the body untouched when within limits', () => {
    expect(clamp('hello', 100)).toBe('hello')
  })

  it('replaces a whitespace-only body with "…" so PATCH passes the trim().min(1) check', () => {
    expect(clamp('', 100)).toBe('…')
    expect(clamp('   ', 100)).toBe('…')
    expect(clamp('\n\t', 100)).toBe('…')
  })

  it('truncates over-long bodies to max-1 + ellipsis', () => {
    const body = 'x'.repeat(200)
    const clamped = clamp(body, 50)
    expect(clamped.length).toBe(50)
    expect(clamped.endsWith('…')).toBe(true)
  })
})
