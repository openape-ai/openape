import type { KeyLike } from 'jose'
import type { DDISAAssertionClaims } from '../types/index.js'
import { MAX_ASSERTION_TTL } from '../constants.js'
import { createRemoteJWKS, verifyJWT } from '../crypto/jwt.js'

export interface AssertionValidationOptions {
  /** Expected issuer (must match DNS-delegated IdP) */
  expectedIss: string
  /** Expected audience (must match client_id) */
  expectedAud: string
  /** JWKS URI for the IdP */
  jwksUri?: string
  /** Public key for verification (alternative to jwksUri) */
  publicKey?: KeyLike | Uint8Array
  /** Expected nonce */
  expectedNonce?: string
  /** Current time override for testing */
  now?: number
}

export interface AssertionValidationResult {
  valid: boolean
  claims?: DDISAAssertionClaims
  error?: string
}

/**
 * Validate a DDISA assertion JWT.
 * Checks: signature, iss vs DNS, aud, exp, TTL, nonce.
 */
export async function validateAssertion(
  token: string,
  options: AssertionValidationOptions,
): Promise<AssertionValidationResult> {
  try {
    const verifyKey = options.publicKey
      ?? (options.jwksUri ? createRemoteJWKS(options.jwksUri) : undefined)

    if (!verifyKey) {
      return { valid: false, error: 'No verification key or JWKS URI provided' }
    }

    const { payload } = await verifyJWT<DDISAAssertionClaims>(token, verifyKey, {
      issuer: options.expectedIss,
      audience: options.expectedAud,
    })

    // Check TTL (max 5 minutes)
    const now = options.now ?? Math.floor(Date.now() / 1000)
    if (payload.exp - payload.iat > MAX_ASSERTION_TTL) {
      return { valid: false, error: `Assertion TTL exceeds maximum of ${MAX_ASSERTION_TTL}s` }
    }

    // Check expiration
    if (payload.exp <= now) {
      return { valid: false, error: 'Assertion has expired' }
    }

    // Check nonce if expected
    if (options.expectedNonce && payload.nonce !== options.expectedNonce) {
      return { valid: false, error: 'Nonce mismatch' }
    }

    // Check act claim: string ('human'/'agent') or RFC 8693 delegation object ({ sub: string })
    if (!payload.act) {
      return { valid: false, error: 'Missing act claim' }
    }
    if (typeof payload.act === 'string') {
      if (!['human', 'agent'].includes(payload.act)) {
        return { valid: false, error: 'Invalid act claim' }
      }
    }
    else if (typeof payload.act === 'object') {
      if (!('sub' in payload.act) || typeof payload.act.sub !== 'string') {
        return { valid: false, error: 'Invalid delegation act claim' }
      }
    }
    else {
      return { valid: false, error: 'Invalid act claim type' }
    }

    // Check required fields
    if (!payload.sub) {
      return { valid: false, error: 'Missing sub claim' }
    }

    return { valid: true, claims: payload }
  }
  catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Validation failed' }
  }
}
