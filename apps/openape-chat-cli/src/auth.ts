import { ensureFreshIdpAuth, NotLoggedInError } from '@openape/cli-auth'
import { decodeJwt } from 'jose'

// chat.openape.ai's `resolveCaller` accepts JWKS-verified IdP tokens
// directly (see apps/openape-chat/server/utils/auth.ts). There is currently
// no SP-scoped exchange endpoint at /api/cli/exchange on chat. We use the
// raw IdP access_token until we add SP-token exchange to the chat-app in a
// follow-up PR — at that point this file becomes a `getAuthorizedBearer`
// call against `aud: 'chat.openape.ai'` and the change is invisible to
// command code.

export interface CallerIdentity {
  email: string
  act: 'human' | 'agent'
  /** Unix seconds when the underlying IdP token expires. */
  expires_at: number
}

export async function getChatBearer(): Promise<string> {
  const idp = await ensureFreshIdpAuth()
  return `Bearer ${idp.access_token}`
}

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
