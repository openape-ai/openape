import { describe, expect, it, vi } from 'vitest'

vi.mock('@openape/core', () => ({
  extractDomain: (email: string) => email.split('@')[1] ?? '',
  resolveIdP: vi.fn(async (domain: string) => {
    if (domain === 'openape.ai') return 'https://id.openape.ai'
    if (domain === 'custom.example') return 'https://idp.custom.example'
    throw new Error('No DDISA record')
  }),
}))

const { unsafeDecodeSub, resolveIssuerForToken, FALLBACK_ISSUER } = await import('../src/runtime/server/utils/ddisa-issuer')

function makeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.fakesig`
}

describe('unsafeDecodeSub', () => {
  it('extracts an email sub from a JWT payload', () => {
    const token = makeToken({ sub: 'alice@openape.ai', exp: 9999 })
    expect(unsafeDecodeSub(token)).toBe('alice@openape.ai')
  })

  it('returns null when sub is not an email', () => {
    const token = makeToken({ sub: 'not-an-email' })
    expect(unsafeDecodeSub(token)).toBeNull()
  })

  it('returns null for a malformed token', () => {
    expect(unsafeDecodeSub('not.a.jwt.at.all.extra')).toBeNull()
    expect(unsafeDecodeSub('onlyone')).toBeNull()
  })
})

describe('resolveIssuerForToken', () => {
  it('resolves the authoritative issuer for a known domain', async () => {
    const token = makeToken({ sub: 'alice@openape.ai' })
    const result = await resolveIssuerForToken(token)
    expect(result).not.toBeNull()
    expect(result!.sub).toBe('alice@openape.ai')
    expect(result!.issuer).toBe('https://id.openape.ai')
    expect(result!.jwksUri).toBe('https://id.openape.ai/.well-known/jwks.json')
  })

  it('resolves a custom domain issuer', async () => {
    const token = makeToken({ sub: 'bob@custom.example' })
    const result = await resolveIssuerForToken(token)
    expect(result!.issuer).toBe('https://idp.custom.example')
  })

  it('falls back to FALLBACK_ISSUER when DDISA record is missing', async () => {
    const token = makeToken({ sub: 'charlie@unknown.domain' })
    const result = await resolveIssuerForToken(token)
    // resolveIdP throws for unknown.domain → falls back
    expect(result!.issuer).toBe(FALLBACK_ISSUER)
  })

  it('returns null when token has no usable sub', async () => {
    const token = makeToken({ sub: 'not-an-email' })
    const result = await resolveIssuerForToken(token)
    expect(result).toBeNull()
  })
})
