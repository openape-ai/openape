import type { KeyLike } from 'jose'
import { jwtVerify, SignJWT } from 'jose'

export interface AgentTokenPayload {
  sub: string
  act: 'agent'
}

export async function issueAgentToken(
  payload: { sub: string },
  issuer: string,
  privateKey: KeyLike,
  kid?: string,
): Promise<string> {
  const jwt = new SignJWT({ sub: payload.sub, act: 'agent' })
    .setProtectedHeader({ alg: 'EdDSA', ...(kid ? { kid } : {}) })
    .setIssuer(issuer)
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime('1h')

  return await jwt.sign(privateKey)
}

export async function verifyAgentToken(
  token: string,
  issuer: string,
  publicKey: KeyLike | Uint8Array,
): Promise<AgentTokenPayload> {
  const { payload } = await jwtVerify(token, publicKey, {
    issuer,
    algorithms: ['EdDSA'],
  })

  if (payload.act !== 'agent') {
    throw new Error('Not an agent token')
  }

  return payload as unknown as AgentTokenPayload
}
