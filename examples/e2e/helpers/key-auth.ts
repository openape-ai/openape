import type { KeyObject } from 'node:crypto'
import { sign } from 'node:crypto'

/**
 * Authenticate via SSH key challenge-response flow.
 * Returns a JWT bearer token.
 */
export async function loginWithSshKey(
  baseUrl: string,
  email: string,
  privateKey: KeyObject,
  publicKeySsh: string,
): Promise<string> {
  // Step 1: Request challenge
  const challengeRes = await fetch(`${baseUrl}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: email }),
  })

  if (!challengeRes.ok) {
    const body = await challengeRes.text().catch(() => '')
    throw new Error(`Challenge request failed (${challengeRes.status}): ${body}`)
  }

  const { challenge } = await challengeRes.json() as { challenge: string }

  // Step 2: Sign the challenge
  const signature = sign(null, Buffer.from(challenge), privateKey)

  // Step 3: Authenticate
  const authRes = await fetch(`${baseUrl}/api/auth/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: email,
      challenge,
      signature: signature.toString('base64'),
      public_key: publicKeySsh,
    }),
  })

  if (!authRes.ok) {
    const body = await authRes.text().catch(() => '')
    throw new Error(`Authentication failed (${authRes.status}): ${body}`)
  }

  const { token } = await authRes.json() as { token: string }
  return token
}
