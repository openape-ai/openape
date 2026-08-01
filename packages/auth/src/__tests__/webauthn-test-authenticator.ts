import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/types'
import type { KeyObject } from 'node:crypto'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { isoBase64URL, isoCBOR, isoUint8Array } from '@simplewebauthn/server/helpers'

/**
 * A deterministic software authenticator for exercising the real
 * @simplewebauthn/server verification pipeline in Node — no browser, no mocks.
 * It holds a P-256 (ES256) key pair and emits spec-shaped WebAuthn responses
 * (attestation format `none`) that `verifyRegistrationResponse` and
 * `verifyAuthenticationResponse` fully parse and cryptographically verify.
 */

const AAGUID_BYTES = 16
const CREDENTIAL_ID_BYTES = 32

const FLAG_USER_PRESENT = 0x01
const FLAG_USER_VERIFIED = 0x04
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40

// COSE EC2 key parameters (RFC 9052/9053)
const COSE_KTY = 1
const COSE_ALG = 3
const COSE_CRV = -1
const COSE_X = -2
const COSE_Y = -3
const COSE_KTY_EC2 = 2
const COSE_ALG_ES256 = -7
const COSE_CRV_P256 = 1

interface ResponseOptions {
  challenge: string
  origin: string
  rpId: string
  counter?: number
  userVerified?: boolean
}

interface AuthenticationResponseOptions extends ResponseOptions {
  /** Sign with a foreign key to produce a cryptographically invalid assertion */
  signingKey?: KeyObject
}

export interface TestAuthenticator {
  credentialId: string
  privateKey: KeyObject
  createRegistrationResponse: (options: ResponseOptions) => RegistrationResponseJSON
  createAuthenticationResponse: (options: AuthenticationResponseOptions) => AuthenticationResponseJSON
}

function toBytes(data: Buffer | string): Uint8Array<ArrayBuffer> {
  const buffer = typeof data === 'string' ? Buffer.from(data) : data
  return new Uint8Array(buffer)
}

function sha256(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return toBytes(createHash('sha256').update(data).digest())
}

function encodeClientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string): Uint8Array<ArrayBuffer> {
  return toBytes(JSON.stringify({ type, challenge, origin, crossOrigin: false }))
}

function encodeCounter(counter: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, counter, false)
  return bytes
}

function encodeFlags(userVerified: boolean, attestedCredentialData: boolean): Uint8Array<ArrayBuffer> {
  let flags = FLAG_USER_PRESENT
  if (userVerified) {
    flags |= FLAG_USER_VERIFIED
  }
  if (attestedCredentialData) {
    flags |= FLAG_ATTESTED_CREDENTIAL_DATA
  }
  return new Uint8Array([flags])
}

function encodeCOSEPublicKey(publicKey: KeyObject): Uint8Array<ArrayBuffer> {
  const jwk = publicKey.export({ format: 'jwk' })
  if (!jwk.x || !jwk.y) {
    throw new Error('Exported P-256 JWK is missing coordinates')
  }
  return isoCBOR.encode(new Map<number, number | Uint8Array>([
    [COSE_KTY, COSE_KTY_EC2],
    [COSE_ALG, COSE_ALG_ES256],
    [COSE_CRV, COSE_CRV_P256],
    [COSE_X, isoBase64URL.toBuffer(jwk.x)],
    [COSE_Y, isoBase64URL.toBuffer(jwk.y)],
  ]))
}

export function createTestAuthenticator(): TestAuthenticator {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const credentialIdBytes = toBytes(randomBytes(CREDENTIAL_ID_BYTES))
  const credentialId = isoBase64URL.fromBuffer(credentialIdBytes)

  function createRegistrationResponse(options: ResponseOptions): RegistrationResponseJSON {
    const { challenge, origin, rpId, counter = 0, userVerified = true } = options
    const authData = isoUint8Array.concat([
      sha256(toBytes(rpId)),
      encodeFlags(userVerified, true),
      encodeCounter(counter),
      new Uint8Array(AAGUID_BYTES),
      new Uint8Array([credentialIdBytes.length >> 8, credentialIdBytes.length & 0xFF]),
      credentialIdBytes,
      encodeCOSEPublicKey(publicKey),
    ])
    const attestationObject = isoCBOR.encode(new Map<string, string | Map<never, never> | Uint8Array>([
      ['fmt', 'none'],
      ['attStmt', new Map<never, never>()],
      ['authData', authData],
    ]))

    return {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(encodeClientData('webauthn.create', challenge, origin)),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ['internal'],
      },
    }
  }

  function createAuthenticationResponse(options: AuthenticationResponseOptions): AuthenticationResponseJSON {
    const { challenge, origin, rpId, counter = 1, userVerified = true, signingKey = privateKey } = options
    const authData = isoUint8Array.concat([
      sha256(toBytes(rpId)),
      encodeFlags(userVerified, false),
      encodeCounter(counter),
    ])
    const clientDataJSON = encodeClientData('webauthn.get', challenge, origin)
    const signatureBase = isoUint8Array.concat([authData, sha256(clientDataJSON)])
    // WebAuthn assertion signatures are ASN.1 DER — node:crypto's default for EC keys
    const signature = toBytes(sign('sha256', signatureBase, signingKey))

    return {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(signature),
      },
    }
  }

  return { credentialId, privateKey, createRegistrationResponse, createAuthenticationResponse }
}
