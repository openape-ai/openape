import { ensureFreshIdpAuth } from '@openape/cli-auth'

/** An identity resolved to a bearer token plus the email it belongs to. */
export interface Identity {
  bearer: string
  email: string
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
  return { bearer: auth.access_token, email: auth.email }
}
