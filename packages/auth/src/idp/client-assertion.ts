import type { KeyLike } from 'jose'
import { decodeJwt, jwtVerify } from 'jose'
import type { JtiStore } from './stores.js'

export type AgentKeyResolver = (agentEmail: string) => Promise<KeyLike | null>

export interface ClientAssertionResult {
  sub: string
  iss: string
}

/**
 * Validate a client_assertion JWT (RFC 7523 / private_key_jwt).
 *
 * 1. Decodes payload to read `iss` (agent email)
 * 2. Resolves the agent's public key via callback
 * 3. Verifies JWT signature (EdDSA or ES256)
 * 4. Validates `aud` (must match token endpoint)
 * 5. Validates `exp` (jose does this automatically)
 * 6. Checks `jti` for replay protection
 */
export async function validateClientAssertion(
  assertion: string,
  expectedAudience: string,
  resolveAgentKey: AgentKeyResolver,
  jtiStore: JtiStore,
): Promise<ClientAssertionResult> {
  // Decode without verification to get issuer (agent email)
  const claims = decodeJwt(assertion)

  if (!claims.iss) {
    throw new Error('Missing iss claim in client assertion')
  }

  if (!claims.jti) {
    throw new Error('Missing jti claim in client assertion')
  }

  // Resolve agent public key
  const publicKey = await resolveAgentKey(claims.iss)
  if (!publicKey) {
    throw new Error('Unknown agent')
  }

  // Verify signature + expiration + audience
  const { payload } = await jwtVerify(assertion, publicKey, {
    audience: expectedAudience,
    clockTolerance: 5,
  })

  // Check JTI replay
  if (await jtiStore.hasBeenUsed(payload.jti!)) {
    throw new Error('JTI already used (replay)')
  }

  // Mark JTI as used with TTL matching assertion lifetime
  const ttl = (payload.exp ?? 0) - Math.floor(Date.now() / 1000)
  await jtiStore.markUsed(payload.jti!, Math.max(ttl, 60) * 1000)

  return {
    sub: String(payload.sub ?? payload.iss),
    iss: String(payload.iss),
  }
}
