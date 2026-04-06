import type { ActorType } from '@openape/core'
import type { KeyLike } from 'jose'
import { jwtVerify, SignJWT } from 'jose'

export interface AuthTokenPayload {
  sub: string
  act: ActorType
}

export async function issueAuthToken(
  payload: { sub: string, act: ActorType },
  issuer: string,
  privateKey: KeyLike,
  kid?: string,
): Promise<string> {
  const jwt = new SignJWT({ sub: payload.sub, act: payload.act })
    .setProtectedHeader({ alg: 'EdDSA', ...(kid ? { kid } : {}) })
    .setIssuer(issuer)
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime('1h')

  return await jwt.sign(privateKey)
}

export async function verifyAuthToken(
  token: string,
  issuer: string,
  publicKey: KeyLike | Uint8Array,
): Promise<AuthTokenPayload> {
  const { payload } = await jwtVerify(token, publicKey, {
    issuer,
    algorithms: ['EdDSA'],
  })

  const act = payload.act
  if (act !== 'agent' && act !== 'human') {
    throw new Error('Invalid act claim')
  }

  return { sub: payload.sub as string, act }
}
