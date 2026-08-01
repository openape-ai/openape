// Security checklist: OIDC userinfo endpoint — bearer-token gating with
// WWW-Authenticate challenges, signature/issuer verification, and a
// response limited to profile claims (no token internals leak).

import { generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const ISSUER = 'https://id.openape.test'

let keys: Awaited<ReturnType<typeof generateKeyPair>>

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  getHeader: (event: any, name: string) => event.headers?.[name.toLowerCase()],
  setResponseStatus: (event: any, status: number) => { event.responseStatus = status },
}))

vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => ISSUER,
  useIdpStores: () => ({
    keyStore: {
      getSigningKey: async () => ({ kid: 'k1', privateKey: keys.privateKey, publicKey: keys.publicKey }),
    },
  }),
}))

function makeEvent(token?: string) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    node: { res: { headers: {} as Record<string, string>, setHeader(name: string, value: string) { this.headers[name] = value } } },
  } as any
}

async function callUserinfo(event: any) {
  const { default: handler } = await import('../src/runtime/server/routes/userinfo.get')
  return handler(event)
}

async function signToken(claims: Record<string, unknown>, issuer = ISSUER) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(keys.privateKey)
}

describe('userinfo endpoint', () => {
  beforeAll(async () => {
    keys = await generateKeyPair('EdDSA')
  })

  it('requires a bearer token and sends a WWW-Authenticate challenge', async () => {
    const event = makeEvent()
    const result = await callUserinfo(event)
    expect(result.error).toBe('invalid_token')
    expect(event.responseStatus).toBe(401)
    expect(event.node.res.headers['WWW-Authenticate']).toBe('Bearer')
  })

  it('rejects a malformed token', async () => {
    const event = makeEvent('garbage')
    const result = await callUserinfo(event)
    expect(result.error).toBe('invalid_token')
    expect(event.responseStatus).toBe(401)
    expect(event.node.res.headers['WWW-Authenticate']).toContain('invalid_token')
  })

  it('rejects a token from a foreign issuer', async () => {
    const token = await signToken({ sub: 'me@example.com' }, 'https://evil.example')
    const result = await callUserinfo(makeEvent(token))
    expect(result.error).toBe('invalid_token')
  })

  it('rejects a token signed with a foreign key', async () => {
    const foreign = await generateKeyPair('EdDSA')
    const token = await new SignJWT({ sub: 'me@example.com' })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(foreign.privateKey)
    const result = await callUserinfo(makeEvent(token))
    expect(result.error).toBe('invalid_token')
  })

  it('returns only profile claims for a valid token', async () => {
    const token = await signToken({
      sub: 'me@example.com',
      email: 'me@example.com',
      name: 'Me',
      act: 'human',
      scope: 'everything',
    })
    const result = await callUserinfo(makeEvent(token))
    expect(result).toEqual({
      sub: 'me@example.com',
      email: 'me@example.com',
      name: 'Me',
    })
  })

  it('omits email and name when the token does not carry them', async () => {
    const token = await signToken({ sub: 'me@example.com' })
    const result = await callUserinfo(makeEvent(token))
    expect(result).toEqual({ sub: 'me@example.com' })
  })
})
