import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/types'
import { base64URLToUint8Array } from './registration.js'
import type { RPConfig, WebAuthnCredential } from './types.js'

export async function createAuthenticationOptions(
  rpConfig: RPConfig,
  credentials?: WebAuthnCredential[],
): Promise<{ options: PublicKeyCredentialRequestOptionsJSON, challenge: string }> {
  const options = await generateAuthenticationOptions({
    rpID: rpConfig.rpID,
    userVerification: rpConfig.requireUserVerification ? 'required' : 'preferred',
    allowCredentials: credentials?.map(c => ({
      id: c.credentialId,
      transports: c.transports,
    })),
  })

  return {
    options,
    challenge: options.challenge,
  }
}

export async function verifyAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  rpConfig: RPConfig,
  credential: WebAuthnCredential,
): Promise<{ verified: boolean, newCounter?: number, credentialId?: string }> {
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rpConfig.origin,
    expectedRPID: rpConfig.rpID,
    requireUserVerification: rpConfig.requireUserVerification ?? false,
    credential: {
      id: credential.credentialId,
      publicKey: base64URLToUint8Array(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports,
    },
  })

  if (!verification.verified) {
    return { verified: false }
  }

  return {
    verified: true,
    newCounter: verification.authenticationInfo.newCounter,
    credentialId: credential.credentialId,
  }
}
