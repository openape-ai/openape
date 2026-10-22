import type { H3Event } from 'h3'
import { normalizeActClaim } from '@openape/core'
import { getHeader, getMethod, setResponseHeader } from 'h3'
import { createProblemError } from './problem'

interface SessionClaims {
  email?: string
  sub?: string
  act?: unknown
}

/**
 * The vault owner behind this request, or a refusal.
 *
 * Vault routes accept only the human's SP browser session. `requireCaller`
 * also accepts bearer tokens and does not say which one authenticated, so this
 * reads the same `openape-sp` session directly: a token with `act: human` is
 * not enough to manage a vault. Writes must come from the vault's own origin.
 */
export async function requireVaultOwner(event: H3Event): Promise<string> {
  const config = useRuntimeConfig()
  if (!config.vaultEnabled) throw createProblemError({ status: 404, title: 'Not found' })
  setResponseHeader(event, 'cache-control', 'no-store')

  const session = await getSpSession(event)
  const claims = session.data?.claims as SessionClaims | undefined
  const email = claims?.email ?? claims?.sub
  if (!email) throw createProblemError({ status: 401, title: 'Sign in to use your vault' })
  if (normalizeActClaim(claims?.act) !== 'human') {
    throw createProblemError({ status: 403, title: 'Only a person can use a vault', detail: 'Agents request secrets; they never manage a vault.' })
  }
  if (getMethod(event) !== 'GET' && getHeader(event, 'origin') !== config.vaultOrigin) {
    throw createProblemError({ status: 403, title: 'Request refused', detail: 'Vault changes must come from the Secrets site itself.' })
  }
  return email
}
