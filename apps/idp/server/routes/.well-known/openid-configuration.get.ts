export default defineEventHandler(() => {
  const rc = useRuntimeConfig()
  const issuer = (rc.issuer as string || '').trim()
  return {
    issuer,
    authorization_endpoint: issuer + '/authorize',
    token_endpoint: issuer + '/token',
    jwks_uri: issuer + '/.well-known/jwks.json',
    ddisa_auth_challenge_endpoint: issuer + '/api/auth/challenge',
    ddisa_auth_authenticate_endpoint: issuer + '/api/auth/authenticate',
    openape_grants_endpoint: issuer + '/api/grants',
    openape_delegations_endpoint: issuer + '/api/delegations',
  }
})
