import { describe, expect, it } from 'vitest'
import { normalizeActClaim } from '../identity/index.js'

describe('normalizeActClaim', () => {
  it('maps the literal string "human" to human', () => {
    expect(normalizeActClaim('human')).toBe('human')
  })

  it('maps the literal string "agent" to agent', () => {
    expect(normalizeActClaim('agent')).toBe('agent')
  })

  it('maps an RFC 8693 delegation object to agent — never human', () => {
    expect(normalizeActClaim({ sub: 'igor4-cb6bf26a+patrick+hofmann_eco@id.openape.ai' })).toBe('agent')
  })

  it('fails closed to agent for an absent claim', () => {
    expect(normalizeActClaim(undefined)).toBe('agent')
    expect(normalizeActClaim(null)).toBe('agent')
  })

  it('fails closed to agent for unrecognized strings', () => {
    expect(normalizeActClaim('other')).toBe('agent')
    expect(normalizeActClaim('')).toBe('agent')
    expect(normalizeActClaim('Human')).toBe('agent')
  })

  it('fails closed to agent for malformed objects', () => {
    expect(normalizeActClaim({})).toBe('agent')
    expect(normalizeActClaim({ sub: 42 })).toBe('agent')
    expect(normalizeActClaim([])).toBe('agent')
  })

  it('fails closed to agent for other primitives', () => {
    expect(normalizeActClaim(42)).toBe('agent')
    expect(normalizeActClaim(true)).toBe('agent')
  })
})
