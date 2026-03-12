export { createAuthenticationOptions, verifyAuthentication } from './authentication.js'
export { base64URLToUint8Array, createRegistrationOptions, uint8ArrayToBase64URL, verifyRegistration } from './registration.js'
export type {
  ChallengeStore,
  CredentialStore,
  RegistrationUrl,
  RegistrationUrlStore,
  RPConfig,
  WebAuthnChallenge,
  WebAuthnCredential,
} from './types.js'
