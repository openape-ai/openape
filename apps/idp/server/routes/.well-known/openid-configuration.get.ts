export default defineEventHandler((event) => {
  // Override the default no-store with a cacheable policy for discovery metadata
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')

  const config = getIdPConfig()
  const issuer = config.issuer

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

    // DDISA extensions
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
})
