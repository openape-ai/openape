import { ensureFreshIdpAuth } from '@openape/cli-auth'

/** An identity resolved to a bearer token plus the email and IdP it belongs to. */
export interface Identity {
  bearer: string
  email: string
  /**
   * The IdP that issued this token. Carried per identity rather than taken
   * from a global default: an agent enrolled against a self-hosted IdP would
   * otherwise have its bearer sent to id.openape.ai, which both fails and
   * hands the token to an unrelated service.
   */
  idp: string
}

/**
 * Resolve one identity to a usable bearer.
 *
 * `authHome` selects whose identity: an agent's operator home for requests,
 * omitted for the owner who approves. Both are needed in the same process,
 * which is why this goes through `@openape/cli-auth` — apes resolves
 * `APES_AUTH_FILE` into a module-level constant and can only ever hold one.
 *
 * The gateway is long-running, so the token is refreshed per call rather than
 * cached; `ensureFreshIdpAuth` is a no-op when the current one is still valid.
 */
export async function resolveIdentity(authHome?: string): Promise<Identity> {
  const auth = await ensureFreshIdpAuth(Math.floor(Date.now() / 1000), authHome)
  return { bearer: auth.access_token, email: auth.email, idp: auth.idp }
}
