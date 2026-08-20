import { describe, expect, it } from 'vitest'
import { extractToken } from '../src/commands/accept.ts'

describe('extractToken', () => {
  it('reads the token out of an invite URL', () => {
    expect(extractToken('https://crm.openape.ai/invite?token=abc123')).toBe('abc123')
  })

  it('passes a raw token through', () => {
    expect(extractToken('  abc123 ')).toBe('abc123')
  })

  it('returns null for a URL without a token', () => {
    expect(extractToken('https://crm.openape.ai/invite')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(extractToken('   ')).toBeNull()
  })
})
