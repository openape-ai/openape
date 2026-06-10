import { randomBytes } from 'node:crypto'
import { generateCodeChallenge } from '@openape/core'
import { useRuntimeConfig } from 'nitropack/runtime'
import { requireOwnedOrg } from '../../../../../utils/orgs'

// GET /api/orgs/:id/members/:email/spawn-authorize
//
// Kicks off the cross-SP delegation spawn via redirect/code (replaces the
// browser findStandingGrant + fetchAuthzJwt + IdP-CORS path). The org
// *server* mints PKCE, stashes the verifier + CSRF state in the SP session,
// and 302s the browser to the IdP's /authorize-cross-sp. The Owner's IdP
// session cookie travels on that top-level navigation — no CORS. The IdP
// returns a code to /oauth/grants/callback, which redeems it server-to-server.
export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const email = getRouterParam(event, 'email')
  if (!email) throw createError({ statusCode: 400, statusMessage: 'member email required' })

  const config = useRuntimeConfig()
  const idpUrl = (config.public as { idpUrl?: string }).idpUrl as string
  const clientId = config.openapeSp.clientId as string
  const troopHost = new URL(config.troopApiBase as string).host

  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = randomBytes(16).toString('base64url')
  const origin = getRequestURL(event).origin
  const redirectUri = `${origin}/oauth/grants/callback`

  // Stash the one-shot PKCE/CSRF context for the callback. Merges into the
  // SP session (does not clobber the auth claims).
  const session = await getSpSession(event)
  await session.update({ crossSpSpawn: { codeVerifier, state, memberEmail: email, orgId: org.id, redirectUri } })

  const authorize = new URL('/authorize-cross-sp', idpUrl)
  authorize.searchParams.set('client_id', clientId)
  authorize.searchParams.set('audience', troopHost)
  authorize.searchParams.set('scope', 'troop:spawn-agent')
  authorize.searchParams.set('redirect_uri', redirectUri)
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('code_challenge', codeChallenge)
  authorize.searchParams.set('code_challenge_method', 'S256')
  return sendRedirect(event, authorize.toString())
})
