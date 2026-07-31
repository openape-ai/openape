import { describe, it } from 'vitest'

// TODO: These need real integration tests against @simplewebauthn/server
// (not mock-wiring tests). Requires a WebAuthn test harness.
describe('createAuthenticationOptions', () => {
  it.todo('generates authentication options')
  it.todo('passes credentials as allowCredentials')
})

describe('verifyAuthentication', () => {
  it.todo('verifies and returns new counter on success')
  it.todo('returns verified false on failure')
})
