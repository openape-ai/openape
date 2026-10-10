import { open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureFreshIdpAuth, getConfigDir, loadIdpAuth, NotLoggedInError } from '@openape/cli-auth'
import type { IdpAuth } from '@openape/cli-auth'

/** The owner's apes CLI login as Pods may use it: read its current token, never log in or out. */
export interface ApesLogin {
  /** The current access token of the apes login, renewed through cli-auth when it expired; null without a usable login. */
  token: (signal: AbortSignal) => Promise<{ issuer: string, accessToken: string } | null>
  /** Whether apes is still logged in as this account at this issuer; `apes logout` makes it false. */
  signedIn: (issuer: string, account: string) => boolean
}

const skewSeconds = 30
const lockWait = 5000

function origin(value: string): string | null {
  try { return new URL(value).origin }
  catch { return null }
}

function fresh(auth: IdpAuth | null): boolean {
  return !!auth && typeof auth.access_token === 'string' && !!auth.access_token && typeof auth.expires_at === 'number' && auth.expires_at > Date.now() / 1000 + skewSeconds
}

// apes serializes its own refreshes with this lock file (packages/apes/src/auth-lock.ts) because the IdP rotates
// refresh tokens and revokes the whole family when one is used twice. Pods takes the same lock around the cli-auth
// refresh, so it never races a running apes command. While apes holds the lock, Pods only reads what apes stores.
async function renewLocked(signal: AbortSignal): Promise<IdpAuth | null> {
  const file = join(getConfigDir(), 'auth.json.lock')
  const deadline = Date.now() + lockWait
  for (;;) {
    signal.throwIfAborted()
    const current = loadIdpAuth()
    if (fresh(current)) return current
    if (!current?.refresh_token || current.key_path) return null
    let handle
    try { handle = await open(file, 'wx') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (Date.now() >= deadline) return null
      await new Promise(resolve => setTimeout(resolve, 100))
      continue
    }
    try {
      // A rejected refresh token means apes is logged out; cli-auth then records that in auth.json as apes itself does.
      return await ensureFreshIdpAuth().catch((error: unknown) => { if (error instanceof NotLoggedInError) return null; throw error })
    }
    finally { await handle.close(); await rm(file, { force: true }) }
  }
}

async function token(signal: AbortSignal): Promise<{ issuer: string, accessToken: string } | null> {
  const stored = loadIdpAuth()
  if (!stored?.access_token) return null
  const issuer = origin(stored.idp)
  if (!issuer) return null
  if (fresh(stored)) return { issuer, accessToken: stored.access_token }
  // Agent logins renew by signing with their key; that identity is refused anyway, so Pods never renews it.
  if (!stored.refresh_token || stored.key_path) return null
  const renewal = renewLocked(signal)
  // cli-auth's refresh takes no signal; the caller stops waiting, while the lock is released only once it settles.
  renewal.catch(() => {})
  const renewed = await Promise.race([renewal, new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })])
  return renewed && fresh(renewed) && origin(renewed.idp) === issuer ? { issuer, accessToken: renewed.access_token } : null
}

function signedIn(issuer: string, account: string): boolean {
  const stored = loadIdpAuth()
  return !!stored?.access_token && origin(stored.idp) === issuer && stored.email?.trim().toLowerCase() === account.trim().toLowerCase() && (!!stored.refresh_token || fresh(stored))
}

export const apesLogin: ApesLogin = { token, signedIn }
