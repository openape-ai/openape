import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server'
import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/types'
import type { RPConfig, WebAuthnCredential } from './types.js'

const RE_PLUS = /\+/g
const RE_SLASH = /\//g
const RE_EQUALS = /=/g
const RE_DASH = /-/g
const RE_UNDERSCORE = /_/g

export function uint8ArrayToBase64URL(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(RE_PLUS, '-').replace(RE_SLASH, '_').replace(RE_EQUALS, '')
}

export function base64URLToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(RE_DASH, '+').replace(RE_UNDERSCORE, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export async function createRegistrationOptions(
  rpConfig: RPConfig,
  email: string,
  name: string,
  existingCredentials: WebAuthnCredential[] = [],
): Promise<{ options: PublicKeyCredentialCreationOptionsJSON, challenge: string }> {
  const options = await generateRegistrationOptions({
    rpName: rpConfig.rpName,
    rpID: rpConfig.rpID,
    userName: email,
    userDisplayName: name,
    attestationType: rpConfig.attestationType || 'none',
    excludeCredentials: existingCredentials.map(c => ({
      id: c.credentialId,
      transports: c.transports,
    })),
    authenticatorSelection: {
      residentKey: rpConfig.residentKey || 'preferred',
      userVerification: rpConfig.requireUserVerification ? 'required' : 'preferred',
    },
  })

  return {
    options,
    challenge: options.challenge,
  }
}

export async function verifyRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  rpConfig: RPConfig,
  email: string,
): Promise<{ verified: boolean, credential?: WebAuthnCredential }> {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rpConfig.origin,
    expectedRPID: rpConfig.rpID,
    requireUserVerification: rpConfig.requireUserVerification ?? false,
  })

  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false }
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

  return {
    verified: true,
    credential: {
      credentialId: credential.id,
      userEmail: email,
      publicKey: uint8ArrayToBase64URL(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      createdAt: Date.now(),
    },
  }
}
