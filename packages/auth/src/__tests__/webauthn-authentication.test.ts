import { describe, it } from 'vitest'

// TODO: These need real integration tests against @simplewebauthn/server
// (not mock-wiring tests). Requires a WebAuthn test harness.
describe.skip('createAuthenticationOptions', () => {
  it.skip('generates authentication options', () => {})
  it.skip('passes credentials as allowCredentials', () => {})
})

describe.skip('verifyAuthentication', () => {
  it.skip('verifies and returns new counter on success', () => {})
  it.skip('returns verified false on failure', () => {})
})
