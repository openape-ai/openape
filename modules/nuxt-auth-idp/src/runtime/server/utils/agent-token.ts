import type { ActorType, DelegationActClaim } from '@openape/core'
import type { KeyLike } from 'jose'
import { jwtVerify, SignJWT } from 'jose'

// --- Generalized auth token (supports both 'agent' and 'human') ---

/**
 * Default audience for CLI-issued tokens. Every token issued by the IdP for
 * the apes ecosystem carries `aud='apes-cli'` so that downstream service
 * providers (plans, tasks, secrets, …) can enforce `expectedAud='apes-cli'`
 * on their `/api/cli/exchange` endpoints and reject tokens minted for any
 * other purpose (id_tokens, delegation tokens, future client-credentials
 * with explicit audience).
 */
export const DEFAULT_CLI_AUDIENCE = 'apes-cli'

export interface AuthTokenPayload {
  sub: string
  /** Either a simple actor-type string ('human' | 'agent') for direct
   * tokens, or a structured DDISA DelegationActClaim object for
   * delegated tokens minted via /api/oauth/token-exchange. The
   * structured form's `sub` field is the email of the actor (delegate).
   */
  act: ActorType | DelegationActClaim
  aud?: string
  /** Set on delegated tokens — the id of the delegation grant that
   * authorised this token-exchange. */
  delegation_grant?: string
}

export async function issueAuthToken(
  payload: { sub: string, act: ActorType, aud?: string },
  issuer: string,
  privateKey: KeyLike,
  kid?: string,
): Promise<string> {
  const jwt = new SignJWT({ sub: payload.sub, act: payload.act })
    .setProtectedHeader({ alg: 'EdDSA', ...(kid ? { kid } : {}) })
    .setIssuer(issuer)
    .setSubject(payload.sub)
    .setAudience(payload.aud ?? DEFAULT_CLI_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('1h')

  return await jwt.sign(privateKey)
}

export async function verifyAuthToken(
  token: string,
  issuer: string,
  publicKey: KeyLike | Uint8Array,
  expectedAud?: string,
): Promise<AuthTokenPayload> {
  const { payload } = await jwtVerify(token, publicKey, {
    issuer,
    ...(expectedAud ? { audience: expectedAud } : {}),
    algorithms: ['EdDSA'],
  })

  const rawAct = payload.act
  let act: ActorType | DelegationActClaim
  if (rawAct === 'agent' || rawAct === 'human') {
    act = rawAct
  }
  else if (rawAct && typeof rawAct === 'object' && typeof (rawAct as DelegationActClaim).sub === 'string') {
    act = rawAct as DelegationActClaim
  }
  else {
    throw new Error('Invalid act claim')
  }

  return {
    sub: payload.sub as string,
    act,
    ...(typeof payload.aud === 'string' ? { aud: payload.aud } : {}),
    ...(typeof payload.delegation_grant === 'string' ? { delegation_grant: payload.delegation_grant } : {}),
  }
}

// --- Agent-specific wrappers (backward compatibility) ---

export interface AgentTokenPayload {
  sub: string
  act: 'agent'
  aud?: string
}

export async function issueAgentToken(
  payload: { sub: string, aud?: string },
  issuer: string,
  privateKey: KeyLike,
  kid?: string,
): Promise<string> {
  return issueAuthToken(
    { sub: payload.sub, act: 'agent', aud: payload.aud ?? DEFAULT_CLI_AUDIENCE },
    issuer,
    privateKey,
    kid,
  )
}

export async function verifyAgentToken(
  token: string,
  issuer: string,
  publicKey: KeyLike | Uint8Array,
  expectedAud?: string,
): Promise<AgentTokenPayload> {
  const result = await verifyAuthToken(token, issuer, publicKey, expectedAud)
  if (result.act !== 'agent') {
    throw new Error('Not an agent token')
  }
  return result as AgentTokenPayload
}
