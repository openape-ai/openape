import type { KeyLike } from 'jose'
import { SignJWT, generateKeyPair } from 'jose'
import { describe, expect, it } from 'vitest'
import { validateClientAssertion } from '../idp/client-assertion.js'
import { InMemoryJtiStore } from '../idp/stores.js'

const TOKEN_ENDPOINT = 'https://id.openape.at/token'
const AGENT_EMAIL = 'agent+test@id.openape.at'

async function createAgentKeyPair() {
  return generateKeyPair('EdDSA', { crv: 'Ed25519' })
}

async function buildClientAssertion(
  privateKey: KeyLike,
  overrides: Partial<{
    iss: string
    sub: string
    aud: string
    exp: string
    jti: string
    iat: boolean
  }> = {},
): Promise<string> {
  const builder = new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(overrides.iss ?? AGENT_EMAIL)
    .setSubject(overrides.sub ?? AGENT_EMAIL)
    .setAudience(overrides.aud ?? TOKEN_ENDPOINT)
    .setExpirationTime(overrides.exp ?? '60s')
    .setJti(overrides.jti ?? crypto.randomUUID())

  if (overrides.iat !== false) {
    builder.setIssuedAt()
  }

  return builder.sign(privateKey)
}

describe('InMemoryJtiStore cleanup', () => {
  it('cleans up expired JTIs during hasBeenUsed check', async () => {
    const jtiStore = new InMemoryJtiStore()
    // Mark a JTI with 1ms TTL
    await jtiStore.markUsed('expired-jti', 1)
    // Wait for expiry
    await new Promise(r => setTimeout(r, 10))
    // hasBeenUsed should return false after cleanup
    expect(await jtiStore.hasBeenUsed('expired-jti')).toBe(false)
  })
})

describe('validateClientAssertion', () => {
  it('validates a correct client assertion', async () => {
    const { publicKey, privateKey } = await createAgentKeyPair()
    const jtiStore = new InMemoryJtiStore()
    const assertion = await buildClientAssertion(privateKey)

    const result = await validateClientAssertion(
      assertion,
      TOKEN_ENDPOINT,
      async (email) => {
        expect(email).toBe(AGENT_EMAIL)
        return publicKey
      },
      jtiStore,
    )

    expect(result.iss).toBe(AGENT_EMAIL)
    expect(result.sub).toBe(AGENT_EMAIL)
  })

  it('rejects invalid signature', async () => {
    const { privateKey } = await createAgentKeyPair()
    const { publicKey: wrongKey } = await createAgentKeyPair()
    const jtiStore = new InMemoryJtiStore()
    const assertion = await buildClientAssertion(privateKey)

    await expect(validateClientAssertion(
      assertion,
      TOKEN_ENDPOINT,
      async () => wrongKey,
      jtiStore,
    )).rejects.toThrow()
  })

  it('rejects expired JWT', async () => {
    const { publicKey, privateKey } = await createAgentKeyPair()
    const jtiStore = new InMemoryJtiStore()

    // Build JWT with exp in the past (beyond 5s clock tolerance)
    const assertion = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(AGENT_EMAIL)
      .setSubject(AGENT_EMAIL)
      .setAudience(TOKEN_ENDPOINT)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .setJti(crypto.randomUUID())
      .setIssuedAt()
      .sign(privateKey)

    await expect(validateClientAssertion(
      assertion,
      TOKEN_ENDPOINT,
      async () => publicKey,
      jtiStore,
    )).rejects.toThrow()
  })

  it('rejects wrong audience', async () => {
    const { publicKey, privateKey } = await createAgentKeyPair()
    const jtiStore = new InMemoryJtiStore()
    const assertion = await buildClientAssertion(privateKey, { aud: 'https://wrong.example.com/token' })

    await expect(validateClientAssertion(
      assertion,
      TOKEN_ENDPOINT,
      async () => publicKey,
      jtiStore,
    )).rejects.toThrow()
  })

  it('rejects replay (same jti)', async () => {
    const { publicKey, privateKey } = await createAgentKeyPair()
    const jtiStore = new InMemoryJtiStore()
    const jti = crypto.randomUUID()
    const assertion = await buildClientAssertion(privateKey, { jti })

    // First use succeeds
    await validateClientAssertion(
      assertion,
      TOKEN_ENDPOINT,
      async () => publicKey,
      jtiStore,
    )

    // Second use with same jti fails
    const assertion2 = await buildClientAssertion(privateKey, { jti })
    await expect(validateClientAssertion(
      assertion2,
      TOKEN_ENDPOINT,
      async () => publicKey,
      jtiStore,
    )).rejects.toThrow('JTI already used')
  })

  it('rejects unknown agent', async () => {
    const { privateKey } = await createAgentKeyPair()
    const jtiStore = new InMemoryJtiStore()
    const assertion = await buildClientAssertion(privateKey)

    await expect(validateClientAssertion(
      assertion,
      TOKEN_ENDPOINT,
      async () => null,
      jtiStore,
    )).rejects.toThrow('Unknown agent')
  })

  it('rejects assertion without iss', async () => {
    const { publicKey, privateKey } = await createAgentKeyPair()
    const jtiStore = new InMemoryJtiStore()

    // Build manually without iss
    const assertion = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject(AGENT_EMAIL)
      .setAudience(TOKEN_ENDPOINT)
      .setExpirationTime('60s')
      .setJti(crypto.randomUUID())
      .setIssuedAt()
      .sign(privateKey)

    await expect(validateClientAssertion(
      assertion,
      TOKEN_ENDPOINT,
      async () => publicKey,
      jtiStore,
    )).rejects.toThrow('Missing iss')
  })

  it('rejects assertion without jti', async () => {
    const { publicKey, privateKey } = await createAgentKeyPair()
    const jtiStore = new InMemoryJtiStore()

    // Build manually without jti
    const assertion = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(AGENT_EMAIL)
      .setSubject(AGENT_EMAIL)
      .setAudience(TOKEN_ENDPOINT)
      .setExpirationTime('60s')
      .setIssuedAt()
      .sign(privateKey)

    await expect(validateClientAssertion(
      assertion,
      TOKEN_ENDPOINT,
      async () => publicKey,
      jtiStore,
    )).rejects.toThrow('Missing jti')
  })
})
