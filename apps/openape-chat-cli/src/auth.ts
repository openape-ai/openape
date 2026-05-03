import { AuthError, ensureFreshIdpAuth, getAuthorizedBearer, NotLoggedInError } from '@openape/cli-auth'
import { decodeJwt } from 'jose'
import { getEndpoint } from './config'

const AUDIENCE = 'chat.openape.ai'

export interface CallerIdentity {
  email: string
  act: 'human' | 'agent'
  /** Unix seconds when the underlying IdP token expires. */
  expires_at: number
}

/**
 * Returns an `Authorization: Bearer …` header valid for chat.openape.ai.
 *
 * Prefers SP-scoped tokens minted by `${endpoint}/api/cli/exchange` (cached
 * 30 days at `~/.config/apes/sp-tokens/chat.openape.ai.json`). Falls back to
 * the raw IdP access_token if the chat-app deployment is older than the
 * exchange endpoint — chat's `resolveCaller` accepts both shapes.
 */
export async function getChatBearer(): Promise<string> {
  try {
    return await getAuthorizedBearer({ endpoint: getEndpoint(null), aud: AUDIENCE })
  }
  catch (err) {
    if (err instanceof AuthError && err.status === 404) {
      // Pre-exchange deployment — use the raw IdP token directly.
      const idp = await ensureFreshIdpAuth()
      return `Bearer ${idp.access_token}`
    }
    throw err
  }
}

/**
 * Identity is read from the IdP token (not the SP-scoped chat token) so we
 * always show the fully-qualified user/agent identity even when the
 * SP-token's claims have been pruned.
 */
export async function getChatCaller(): Promise<CallerIdentity> {
  const idp = await ensureFreshIdpAuth()
  const claims = decodeJwt(idp.access_token) as { sub?: string, act?: string, exp?: number }
  if (!claims.sub) {
    throw new NotLoggedInError('IdP token has no sub claim — run `apes login <email>` to refresh.')
  }
  return {
    email: claims.sub,
    act: claims.act === 'agent' ? 'agent' : 'human',
    expires_at: claims.exp ?? 0,
  }
}
