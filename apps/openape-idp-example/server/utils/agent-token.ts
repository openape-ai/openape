import type { KeyLike } from 'jose'
import { jwtVerify, SignJWT } from 'jose'

export interface AgentTokenPayload {
  sub: string
  type: 'agent'
  name: string
  owner: string
  approver: string
}

export async function issueAgentToken(
  payload: Omit<AgentTokenPayload, 'type'>,
  issuer: string,
  privateKey: KeyLike,
  kid?: string,
): Promise<string> {
  const jwt = new SignJWT({ ...payload, type: 'agent' })
    .setProtectedHeader({ alg: 'ES256', ...(kid ? { kid } : {}) })
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
    algorithms: ['ES256'],
  })

  if (payload.type !== 'agent') {
    throw new Error('Not an agent token')
  }

  return payload as unknown as AgentTokenPayload
}
