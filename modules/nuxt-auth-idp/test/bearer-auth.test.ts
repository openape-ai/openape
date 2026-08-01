// Security checklist: bearer token auth — JWT signature/issuer checks and
// the aud='apes-cli' enforcement (#283): tokens minted for any other
// audience must not authenticate against IdP APIs.

import { generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { issueAuthToken } from '../src/runtime/server/utils/agent-token'

const ISSUER = 'https://id.openape.test'

let keys: Awaited<ReturnType<typeof generateKeyPair>>

vi.mock('h3', () => ({
  getHeader: (event: any, name: string) => event.headers?.[name.toLowerCase()],
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
}))

vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => ISSUER,
  useIdpStores: () => ({
    keyStore: {
      getSigningKey: async () => ({ kid: 'k1', privateKey: keys.privateKey, publicKey: keys.publicKey }),
    },
  }),
}))

function eventWithToken(token?: string) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} } as any
}

describe('bearer auth', () => {
  beforeAll(async () => {
    keys = await generateKeyPair('EdDSA')
  })

  it('tryBearerAuth returns null without an Authorization header', async () => {
    const { tryBearerAuth } = await import('../src/runtime/server/utils/agent-auth')
    expect(await tryBearerAuth(eventWithToken())).toBeNull()
  })

  it('tryBearerAuth accepts a valid apes-cli token', async () => {
    const { tryBearerAuth } = await import('../src/runtime/server/utils/agent-auth')
    const token = await issueAuthToken({ sub: 'me@example.com', act: 'human' }, ISSUER, keys.privateKey, 'k1')
    const payload = await tryBearerAuth(eventWithToken(token))
    expect(payload).toMatchObject({ sub: 'me@example.com', act: 'human' })
  })

  it('tryBearerAuth rejects a token minted for a different audience (#283)', async () => {
    const { tryBearerAuth } = await import('../src/runtime/server/utils/agent-auth')
    const token = await issueAuthToken(
      { sub: 'me@example.com', act: 'human', aud: 'some-other-service' },
      ISSUER,
      keys.privateKey,
    )
    expect(await tryBearerAuth(eventWithToken(token))).toBeNull()
  })

  it('tryBearerAuth rejects a token signed by a foreign key', async () => {
    const { tryBearerAuth } = await import('../src/runtime/server/utils/agent-auth')
    const foreign = await generateKeyPair('EdDSA')
    const token = await issueAuthToken({ sub: 'me@example.com', act: 'human' }, ISSUER, foreign.privateKey)
    expect(await tryBearerAuth(eventWithToken(token))).toBeNull()
  })

  it('tryBearerAuth rejects a token from a different issuer', async () => {
    const { tryBearerAuth } = await import('../src/runtime/server/utils/agent-auth')
    const token = await issueAuthToken({ sub: 'me@example.com', act: 'human' }, 'https://evil.example', keys.privateKey)
    expect(await tryBearerAuth(eventWithToken(token))).toBeNull()
  })

  it('tryBearerAuth rejects an expired token', async () => {
    const { tryBearerAuth } = await import('../src/runtime/server/utils/agent-auth')
    const token = await new SignJWT({ sub: 'me@example.com', act: 'human' })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(ISSUER)
      .setSubject('me@example.com')
      .setAudience('apes-cli')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(keys.privateKey)
    expect(await tryBearerAuth(eventWithToken(token))).toBeNull()
  })

  it('tryBearerAuth rejects a token with a malformed act claim', async () => {
    const { tryBearerAuth } = await import('../src/runtime/server/utils/agent-auth')
    const token = await new SignJWT({ sub: 'me@example.com', act: 42 })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(ISSUER)
      .setSubject('me@example.com')
      .setAudience('apes-cli')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(keys.privateKey)
    expect(await tryBearerAuth(eventWithToken(token))).toBeNull()
  })

  it('requireAgent throws 401 without a bearer token', async () => {
    const { requireAgent } = await import('../src/runtime/server/utils/agent-auth')
    await expect(requireAgent(eventWithToken())).rejects.toMatchObject({ statusCode: 401 })
  })

  it('requireAgent rejects a human token', async () => {
    const { requireAgent } = await import('../src/runtime/server/utils/agent-auth')
    const token = await issueAuthToken({ sub: 'me@example.com', act: 'human' }, ISSUER, keys.privateKey)
    await expect(requireAgent(eventWithToken(token))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('requireAgent accepts an agent token', async () => {
    const { requireAgent } = await import('../src/runtime/server/utils/agent-auth')
    const token = await issueAuthToken({ sub: 'bot@example.com', act: 'agent' }, ISSUER, keys.privateKey)
    const payload = await requireAgent(eventWithToken(token))
    expect(payload).toMatchObject({ sub: 'bot@example.com', act: 'agent' })
  })

  it('tryAgentAuth filters out non-agent identities', async () => {
    const { tryAgentAuth } = await import('../src/runtime/server/utils/agent-auth')
    const humanToken = await issueAuthToken({ sub: 'me@example.com', act: 'human' }, ISSUER, keys.privateKey)
    expect(await tryAgentAuth(eventWithToken(humanToken))).toBeNull()

    const agentToken = await issueAuthToken({ sub: 'bot@example.com', act: 'agent' }, ISSUER, keys.privateKey)
    expect(await tryAgentAuth(eventWithToken(agentToken))).toMatchObject({ sub: 'bot@example.com' })
  })
})
