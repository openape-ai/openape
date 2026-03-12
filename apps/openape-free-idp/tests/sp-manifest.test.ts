import { describe, expect, it } from 'vitest'

describe('SP Manifest redirect_uri validation', () => {
  // Test the redirect_uri origin-matching fallback logic directly
  function validateRedirectUriOriginFallback(clientId: string, redirectUri: string): boolean {
    const redirectOrigin = new URL(redirectUri).origin
    const expectedOrigin = clientId.startsWith('http') ? new URL(clientId).origin : `https://${clientId}`
    return redirectOrigin === expectedOrigin
  }

  it('accepts redirect_uri matching client_id origin', () => {
    expect(validateRedirectUriOriginFallback('sp.example.com', 'https://sp.example.com/callback')).toBe(true)
  })

  it('rejects redirect_uri from different origin', () => {
    expect(validateRedirectUriOriginFallback('sp.example.com', 'https://evil.com/callback')).toBe(false)
  })

  it('handles client_id with protocol prefix', () => {
    expect(validateRedirectUriOriginFallback('https://sp.example.com', 'https://sp.example.com/callback')).toBe(true)
  })

  it('rejects http vs https mismatch', () => {
    expect(validateRedirectUriOriginFallback('https://sp.example.com', 'http://sp.example.com/callback')).toBe(false)
  })

  it('rejects subdomain mismatch', () => {
    expect(validateRedirectUriOriginFallback('sp.example.com', 'https://other.example.com/callback')).toBe(false)
  })
})

describe('returnTo validation', () => {
  function isValidReturnTo(returnTo: string): boolean {
    // Only relative paths allowed, no protocol-relative URLs
    return returnTo.startsWith('/') && !returnTo.startsWith('//')
  }

  it('accepts relative paths', () => {
    expect(isValidReturnTo('/authorize?foo=bar')).toBe(true)
    expect(isValidReturnTo('/login')).toBe(true)
  })

  it('rejects protocol-relative URLs', () => {
    expect(isValidReturnTo('//evil.com/callback')).toBe(false)
  })

  it('rejects absolute URLs', () => {
    expect(isValidReturnTo('https://evil.com/callback')).toBe(false)
  })

  it('rejects empty strings', () => {
    expect(isValidReturnTo('')).toBe(false)
  })
})
