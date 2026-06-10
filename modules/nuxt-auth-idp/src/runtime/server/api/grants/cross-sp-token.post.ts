import { introspectGrant, issueAuthzJWT } from '@openape/grants'
import { defineEventHandler, readBody } from 'h3'
import { useGrantStores } from '../../utils/grant-stores'
import { getIdpIssuer, useIdpStores } from '../../utils/stores'
import { createProblemError } from '../../utils/problem'
import { verifyCrossSpCode } from '../../utils/cross-sp-code'

// POST /api/grants/cross-sp-token — redeem a cross-SP delegation code for
// the delegation AuthZ-JWT. Called server-to-server by the Receiver SP's
// backend (no Owner cookie, no CORS): the code + PKCE verifier are the
// proof. Returns the same AuthZ-JWT (aud=apes-cli, sub=Owner) the SP then
// hands to the Provider's /api/cli/exchange.
//
// Body: { code, code_verifier, redirect_uri, client_id }

export default defineEventHandler(async (event) => {
  const body = await readBody<{ code?: string, code_verifier?: string, redirect_uri?: string, client_id?: string }>(event)
  const code = body?.code
  const codeVerifier = body?.code_verifier
  const redirectUri = body?.redirect_uri
  const clientId = body?.client_id
  if (!code || !codeVerifier || !redirectUri || !clientId) {
    throw createProblemError({ status: 400, title: 'Missing required field (code, code_verifier, redirect_uri, client_id)' })
  }

  const { keyStore, jtiStore } = useIdpStores()
  const verified = await verifyCrossSpCode(code, { codeVerifier, clientId, redirectUri }, keyStore, jtiStore)
  if (!verified.ok) {
    throw createProblemError({ status: 400, title: 'invalid_grant', detail: verified.reason })
  }

  const { grantStore } = useGrantStores()
  const grant = await introspectGrant(verified.claims.grant_id, grantStore)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found' })
  }
  // The code binds the grant to the Owner who authorized it — defence in
  // depth even though the code is single-use and signed.
  if (grant.request.requester !== verified.claims.sub) {
    throw createProblemError({ status: 403, title: 'Grant does not belong to the authorizing identity' })
  }
  if (grant.status !== 'approved') {
    throw createProblemError({ status: 400, title: `Grant is not approved (status: ${grant.status})` })
  }

  const signingKey = await keyStore.getSigningKey()
  const authzJwt = await issueAuthzJWT(grant, getIdpIssuer(), signingKey.privateKey, signingKey.kid)
  return { authz_jwt: authzJwt }
})
