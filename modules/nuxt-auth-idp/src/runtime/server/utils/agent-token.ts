import type { ActorType } from '@openape/core'
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
  act: ActorType
  aud?: string
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

  const act = payload.act
  if (act !== 'agent' && act !== 'human') {
    throw new Error('Invalid act claim')
  }

  return {
    sub: payload.sub as string,
    act,
    ...(typeof payload.aud === 'string' ? { aud: payload.aud } : {}),
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
