import type { H3Event } from 'h3'
import type { KeyStore } from '@openape/auth'
import type { AuthTokenPayload } from './auth-token'
import { verifyAuthToken } from './auth-token'

export function extractBearerToken(event: H3Event): string | null {
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer '))
    return null
  return authHeader.slice(7)
}

export async function verifyBearerAuth(
  event: H3Event,
  keyStore: KeyStore,
  issuer: string,
): Promise<AuthTokenPayload | null> {
  const token = extractBearerToken(event)
  if (!token)
    return null

  const signingKey = await keyStore.getSigningKey()

  try {
    return await verifyAuthToken(token, issuer, signingKey.publicKey)
  }
  catch {
    return null
  }
}
