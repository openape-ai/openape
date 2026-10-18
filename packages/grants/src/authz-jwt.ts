import type { OpenApeAuthZClaims, OpenApeCliAuthorizationDetail, OpenApeExecutionContext, OpenApeGrant } from '@openape/core'
import type { JWTPayload, KeyLike, JSONWebKeySet } from 'jose'
import { createLocalJWKSet } from 'jose'
import { createRemoteJWKS, signJWT, verifyJWT } from '@openape/core'
import { brokeredGrantAuthority } from './brokering.js'

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

  if (exp <= now) {
    throw new Error('Grant has already expired')
  }

  const claims: OpenApeAuthZClaims = {
    ...(grant.brokered ? { brokered: brokeredGrantAuthority(grant.brokered) } : {}),
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
    ...(grant.request.authorization_details ? { authorization_details: grant.request.authorization_details } : {}),
    // Delegation grants: surface scopes + delegate inline so a relying party
    // can enforce offline (protocol sp-data-access.md §5). Additive — only
    // present for delegations; non-delegation grants (incl. the apes-cli
    // login token, which is NOT issued via this function) are unchanged.
    ...(grant.request.scopes ? { scope: grant.request.scopes } : {}),
    ...(grant.request.delegate ? { delegate: grant.request.delegate } : {}),
    ...(grant.request.cmd_hash ? { cmd_hash: grant.request.cmd_hash } : {}),
    ...(grant.request.command ? { command: grant.request.command } : {}),
    ...(grant.request.execution_context ? { execution_context: grant.request.execution_context } : {}),
    ...(grant.decided_by ? { decided_by: grant.decided_by } : {}),
    ...(grant.request.run_as ? { run_as: grant.request.run_as } : {}),
  }

  return signJWT(claims as unknown as JWTPayload, privateKey, { kid })
}

/** Longest lifetime of a command token (issue 1473). */
export const COMMAND_TOKEN_LIFETIME_SECONDS = 300

/** The one program call a command token allows. */
export interface CommandTokenCall {
  argvHash: string
  programSha256: string
  /** The IdP's resolved detail of this call. */
  detail: OpenApeCliAuthorizationDetail
  /** The context the IdP wrote for this call; its `argv` is the execution argv. */
  executionContext: OpenApeExecutionContext & { argv: string[] }
}

/**
 * Issue a command token (`POST /api/grants/authorize`): an AuthZ-JWT of an
 * approved grant that is bound to one execution argv (`argv_hash`) and one
 * program file (`program_sha256`). It lives at most five minutes and never
 * beyond the grant.
 */
export async function issueCommandJWT(
  grant: OpenApeGrant,
  call: CommandTokenCall,
  issuer: string,
  privateKey: KeyLike,
  kid?: string,
): Promise<{ token: string, expiresAt: number }> {
  if (grant.status !== 'approved') throw new Error(`Grant is not approved: ${grant.status}`)
  const now = Math.floor(Date.now() / 1000)
  const exp = Math.min(now + COMMAND_TOKEN_LIFETIME_SECONDS, grant.expires_at ?? Number.POSITIVE_INFINITY)
  if (exp <= now) throw new Error('Grant has already expired')
  const grantType = grant.request.grant_type ?? 'once'
  const claims: OpenApeAuthZClaims = {
    ...(grant.brokered ? { brokered: brokeredGrantAuthority(grant.brokered) } : {}),
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
    permissions: [call.detail.permission],
    authorization_details: [call.detail],
    command: call.executionContext.argv,
    execution_context: call.executionContext,
    argv_hash: call.argvHash,
    program_sha256: call.programSha256,
    ...(grant.decided_by ? { decided_by: grant.decided_by } : {}),
    ...(grant.request.run_as ? { run_as: grant.request.run_as } : {}),
  }
  return { token: await signJWT(claims as unknown as JWTPayload, privateKey, { kid }), expiresAt: exp }
}

/**
 * Whether verified `claims` are the command token that spent this single-use
 * grant: the IdP marks a single-use grant used when it issues the command
 * token. Consuming with that token may confirm the consumption once; the
 * caller records that redemption with `GrantStore.markConsumed`.
 */
export function spentByCommandToken(grant: OpenApeGrant, claims: OpenApeAuthZClaims): boolean {
  return grant.status === 'used'
    && typeof claims.jti === 'string'
    && (grant.request.grant_type ?? 'once') === 'once'
    && claims.grant_id === grant.id
    && claims.sub === grant.request.requester
    && typeof claims.argv_hash === 'string'
    && typeof claims.program_sha256 === 'string'
}

export interface VerifyAuthzOptions {
  expectedIss?: string
  expectedAud?: string
  publicKey?: KeyLike | Uint8Array
  jwksUri?: string
  jwks?: JSONWebKeySet
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
      ?? (options.jwks ? createLocalJWKSet(options.jwks) : options.jwksUri ? createRemoteJWKS(options.jwksUri) : undefined)

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
