import { defineEventHandler } from 'h3'
import { getIdpIssuer } from '../../utils/stores'

export default defineEventHandler(() => {
  const issuer = getIdpIssuer()

  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'client_credentials'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
    token_endpoint_auth_signing_alg_values_supported: ['EdDSA', 'ES256'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'email', 'profile'],
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'nonce', 'act', 'email', 'name'],
  }
})
