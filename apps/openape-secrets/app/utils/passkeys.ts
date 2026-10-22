import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { b64u, fromB64u } from '#shared/vault-crypto'

/**
 * Passkey ceremonies with the WebAuthn PRF extension, using the browser API
 * directly: the PRF inputs must be raw bytes, which the JSON helpers do not
 * pass through. Every response is serialized here by hand so that its PRF
 * output can never be sent along — `toJSON()` would include it.
 */

type Bytes = Uint8Array<ArrayBuffer>

interface PrfResults {
  enabled?: boolean
  results?: { first?: ArrayBuffer }
}

export class PasskeyError extends Error {}

const NO_PRF = 'This passkey cannot unlock a vault. Use a passkey saved in iCloud Keychain on an iPhone or Mac, or another passkey that supports the PRF extension.'

function prfOf(credential: PublicKeyCredential): PrfResults | undefined {
  return (credential.getClientExtensionResults() as { prf?: PrfResults }).prf
}

function copy(buffer: ArrayBuffer): Bytes {
  return new Uint8Array(buffer.slice(0))
}

function registrationJSON(credential: PublicKeyCredential): RegistrationResponseJSON {
  const response = credential.response as AuthenticatorAttestationResponse
  return {
    id: credential.id,
    rawId: b64u(credential.rawId),
    type: 'public-key',
    authenticatorAttachment: (credential.authenticatorAttachment ?? undefined) as RegistrationResponseJSON['authenticatorAttachment'],
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64u(response.clientDataJSON),
      attestationObject: b64u(response.attestationObject),
      transports: (response.getTransports?.() ?? []) as RegistrationResponseJSON['response']['transports'],
    },
  }
}

function assertionJSON(credential: PublicKeyCredential): AuthenticationResponseJSON {
  const response = credential.response as AuthenticatorAssertionResponse
  return {
    id: credential.id,
    rawId: b64u(credential.rawId),
    type: 'public-key',
    authenticatorAttachment: (credential.authenticatorAttachment ?? undefined) as AuthenticationResponseJSON['authenticatorAttachment'],
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64u(response.clientDataJSON),
      authenticatorData: b64u(response.authenticatorData),
      signature: b64u(response.signature),
      userHandle: response.userHandle ? b64u(response.userHandle) : undefined,
    },
  }
}

async function getAssertion(publicKey: PublicKeyCredentialRequestOptions): Promise<PublicKeyCredential> {
  const credential = await navigator.credentials.get({ publicKey }).catch((err: Error) => {
    throw new PasskeyError(err.name === 'NotAllowedError' ? 'The passkey prompt was cancelled.' : err.message)
  })
  if (!credential) throw new PasskeyError('No passkey was used.')
  return credential as PublicKeyCredential
}

/** PRF output of one known credential, from a local ceremony the server never sees. */
async function localPrf(credentialId: string, rpId: string, prfInput: Bytes): Promise<Bytes> {
  const credential = await getAssertion({
    challenge: crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32))),
    rpId,
    userVerification: 'required',
    allowCredentials: [{ type: 'public-key', id: fromB64u(credentialId) }],
    extensions: { prf: { eval: { first: prfInput } } } as AuthenticationExtensionsClientInputs,
  })
  const first = prfOf(credential)?.results?.first
  if (!first) throw new PasskeyError(NO_PRF)
  return copy(first)
}

function sameBytes(a: Bytes, b: Bytes): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}

/**
 * Create a passkey that can carry a vault. When the authenticator already
 * returns its PRF output while creating the passkey, that one confirmation is
 * enough (owner decision, issue 1535); the recovery kit covers an authenticator
 * that would later answer differently. Otherwise the PRF output is read in two
 * separate local ceremonies and must match before the server learns about it.
 */
export async function createVaultPasskey(options: PublicKeyCredentialCreationOptionsJSON, prfInput: Bytes) {
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: options.rp,
      user: { ...options.user, id: fromB64u(options.user.id) },
      challenge: fromB64u(options.challenge),
      pubKeyCredParams: options.pubKeyCredParams,
      timeout: options.timeout,
      attestation: 'none',
      authenticatorSelection: options.authenticatorSelection,
      excludeCredentials: (options.excludeCredentials ?? []).map(c => ({ type: 'public-key' as const, id: fromB64u(c.id), transports: c.transports as AuthenticatorTransport[] })),
      extensions: { prf: { eval: { first: prfInput } } } as AuthenticationExtensionsClientInputs,
    },
  }).catch((err: Error) => {
    throw new PasskeyError(err.name === 'NotAllowedError' ? 'The passkey prompt was cancelled.' : err.message)
  }) as PublicKeyCredential | null
  if (!credential) throw new PasskeyError('No passkey was created.')

  const prf = prfOf(credential)
  if (prf?.enabled === false) throw new PasskeyError(NO_PRF)
  const rpId = options.rp.id ?? location.hostname
  if (prf?.results?.first) return { response: registrationJSON(credential), prf: copy(prf.results.first) }

  const first = await localPrf(credential.id, rpId, prfInput)
  const second = await localPrf(credential.id, rpId, prfInput)
  const stable = sameBytes(first, second)
  second.fill(0)
  if (!stable) throw new PasskeyError('This passkey gave a different key each time, so it cannot keep a vault locked safely.')

  return { response: registrationJSON(credential), prf: first }
}

/** A fresh assertion from one of the vault's passkeys, with that passkey's PRF output. */
export async function confirmWithPasskey(options: PublicKeyCredentialRequestOptionsJSON, prfInputs: Record<string, string>) {
  // Browsers refuse PRF inputs for credentials the server did not allow (e.g. the passkey being removed).
  const allowed = new Set((options.allowCredentials ?? []).map(c => c.id))
  const inputs = Object.entries(prfInputs).filter(([id]) => !allowed.size || allowed.has(id))
  const credential = await getAssertion({
    challenge: fromB64u(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout,
    userVerification: 'required',
    allowCredentials: (options.allowCredentials ?? []).map(c => ({ type: 'public-key' as const, id: fromB64u(c.id), transports: c.transports as AuthenticatorTransport[] })),
    extensions: {
      prf: { evalByCredential: Object.fromEntries(inputs.map(([id, input]) => [id, { first: fromB64u(input) }])) },
    } as AuthenticationExtensionsClientInputs,
  })
  const first = prfOf(credential)?.results?.first
  if (!first) throw new PasskeyError(NO_PRF)
  return { response: assertionJSON(credential), credentialId: credential.id, prf: copy(first) }
}

/** A name for the passkey list, from what the browser tells us about it. */
export function passkeyLabel(attachment: string | undefined): string {
  if (attachment === 'cross-platform') return 'Security key'
  if (/iPhone|iPad/.test(navigator.userAgent)) return 'iPhone'
  if (/Macintosh/.test(navigator.userAgent)) return 'Mac'
  return 'This device'
}
