import type { ActorType } from '@openape/core'
import type { KeyLike } from 'jose'
import { jwtVerify, SignJWT } from 'jose'

/**
 * Default audience for CLI-issued tokens. Every token issued by the IdP for
 * the apes ecosystem carries `aud='apes-cli'` so that downstream service
 * providers can enforce `expectedAud='apes-cli'` on their token-exchange
 * endpoints and reject tokens minted for any other purpose.
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
