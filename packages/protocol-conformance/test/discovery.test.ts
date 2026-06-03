import { describe, expect, it } from 'vitest'
import { getValidator } from './harness.js'

/**
 * Build the discovery object exactly as createDiscoveryHandler does,
 * without spinning up an h3 server — the handler is a pure function
 * over config.issuer.
 */
function makeDiscoveryDoc(issuer: string): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    revocation_endpoint: `${issuer}/revoke`,
    grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['EdDSA'],
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
    token_endpoint_auth_signing_alg_values_supported: ['EdDSA'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'email', 'profile', 'offline_access'],
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'nonce', 'act', 'email', 'name', 'authorization_details', 'delegation_grant'],
    authorization_details_types_supported: ['openape_grant', 'openape_cli'],

    // DDISA extensions — as emitted by packages/server/src/idp/handlers/discovery.ts
    ddisa_version: '1.0',
    ddisa_auth_methods_supported: ['ed25519', 'ssh-key'],
    ddisa_auth_challenge_endpoint: `${issuer}/api/auth/challenge`,
    ddisa_auth_authenticate_endpoint: `${issuer}/api/auth/authenticate`,

    // OpenApe extensions
    openape_grants_endpoint: `${issuer}/api/grants`,
    openape_delegations_endpoint: `${issuer}/api/delegations`,
    openape_grant_types_supported: ['once', 'timed', 'always'],
    openape_grant_categories_supported: ['command', 'delegation'],
  }
}

describe('discovery document — openid-configuration-extensions.json', () => {
  const { validate } = getValidator('openid-configuration-extensions.json')
  const issuer = 'https://id.example.com'
  const doc = makeDiscoveryDoc(issuer)

  it('includes required fields (ddisa_version, openape_grants_endpoint)', () => {
    // Schema only requires ddisa_version + ddisa_auth_methods_supported.
    // Verify those are present so the harness is exercising real fields.
    expect(doc.ddisa_version).toBe('1.0')
    expect(Array.isArray(doc.ddisa_auth_methods_supported)).toBe(true)
  })

  // DRIFT: handler emits ddisa_auth_methods_supported: ['ed25519','ssh-key'] but
  // schema enum only allows 'webauthn'|'ed25519' — 'ssh-key' is rejected.
  // Also: handler emits ddisa_auth_challenge_endpoint / ddisa_auth_authenticate_endpoint
  // while schema defines ddisa_agent_challenge_endpoint / ddisa_agent_authenticate_endpoint.
  // The methods array drift is what actually triggers the schema failure here.
  // see docs/superpowers/DRIFT-REPORT-m3.md
  it.fails('full discovery doc validates against schema', () => {
    // DRIFT: ddisa_auth_methods_supported includes 'ssh-key' not in enum ['webauthn','ed25519']; see docs/superpowers/DRIFT-REPORT-m3.md
    const { valid, errors } = validate(doc)
    expect(valid, `Schema errors:\n${errors}`).toBe(true)
  })

  it('validates when ssh-key is removed from ddisa_auth_methods_supported', () => {
    // Confirm harness itself works — a conforming subset passes.
    const conforming = {
      ...doc,
      ddisa_auth_methods_supported: ['ed25519'],
    }
    const { valid, errors } = validate(conforming)
    expect(valid, `Schema errors:\n${errors}`).toBe(true)
  })
})
