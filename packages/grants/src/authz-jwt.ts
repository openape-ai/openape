import type { OpenApeAuthZClaims, OpenApeGrant } from '@openape/core'
import type { JWTPayload, KeyLike } from 'jose'
import { createRemoteJWKS, signJWT, verifyJWT } from '@openape/core'

/**
 * Issue an AuthZ-JWT from an approved grant.
 *
 * Expiration depends on grant type:
 * - 'once' -> 5 minutes
 * - 'timed' -> grant.expires_at
 * - 'always' -> 1 hour (renewable)
 */
export async function issueAuthzJWT(
  grant: OpenApeGrant,
  issuer: string,
  privateKey: KeyLike,
  kid?: string,
): Promise<string> {
  if (grant.status !== 'approved') {
    throw new Error(`Grant is not approved: ${grant.status}`)
  }

  const now = Math.floor(Date.now() / 1000)
  let exp: number

  const grantType = grant.request.grant_type ?? 'once'

  switch (grantType) {
    case 'once':
      exp = now + 300 // 5 minutes
      break
    case 'timed':
      if (!grant.expires_at) {
        throw new Error('Timed grant missing expires_at')
      }
      exp = grant.expires_at
      break
    case 'always':
      exp = now + 3600 // 1 hour
      break
  }

  const claims: OpenApeAuthZClaims = {
    iss: issuer,
    sub: grant.request.requester,
    aud: grant.request.audience,
    target_host: grant.request.target_host,
    iat: now,
    exp,
    jti: crypto.randomUUID(),
    grant_id: grant.id,
    grant_type: grantType,
    approval: grantType,
    ...(grant.request.permissions ? { permissions: grant.request.permissions } : {}),
    ...(grant.request.cmd_hash ? { cmd_hash: grant.request.cmd_hash } : {}),
    ...(grant.request.command ? { command: grant.request.command } : {}),
    ...(grant.decided_by ? { decided_by: grant.decided_by } : {}),
    ...(grant.request.run_as ? { run_as: grant.request.run_as } : {}),
  }

  return signJWT(claims as unknown as JWTPayload, privateKey, { kid })
}

export interface VerifyAuthzOptions {
  expectedIss?: string
  expectedAud?: string
  publicKey?: KeyLike | Uint8Array
  jwksUri?: string
}

/**
 * Verify an AuthZ-JWT and extract its claims.
 */
export async function verifyAuthzJWT(
  token: string,
  options: VerifyAuthzOptions,
): Promise<{ valid: boolean, claims?: OpenApeAuthZClaims, error?: string }> {
  try {
    const verifyKey = options.publicKey
      ?? (options.jwksUri ? createRemoteJWKS(options.jwksUri) : undefined)

    if (!verifyKey) {
      return { valid: false, error: 'No verification key or JWKS URI provided' }
    }

    const verifyOptions: { issuer?: string, audience?: string } = {}
    if (options.expectedIss) {
      verifyOptions.issuer = options.expectedIss
    }
    if (options.expectedAud) {
      verifyOptions.audience = options.expectedAud
    }

    const { payload } = await verifyJWT<OpenApeAuthZClaims>(
      token,
      verifyKey,
      verifyOptions,
    )

    return { valid: true, claims: payload }
  }
  catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Verification failed',
    }
  }
}
