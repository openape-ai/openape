import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { loadIdpAuth } from '@openape/cli-auth'
import type { IdpAuth } from '@openape/cli-auth'

/** The owner's apes CLI login as Pods may use it: read only, never logged in, out or written by Pods. */
export interface ApesLogin {
  /** The current access token of the apes login; null without a login. Throws when apes holds a login Pods cannot use now. */
  token: (signal: AbortSignal) => Promise<{ issuer: string, accessToken: string } | null>
  /** Whether apes is still logged in as this account at this issuer; `apes logout` makes it false. */
  signedIn: (issuer: string, account: string) => boolean
}

/** The bundled apes CLI that renews its own login: Pods' Electron runtime and the CLI entry, never a shell or PATH lookup. */
export interface ApesCommand { executable: string, script: string }

// A token needs this much life left: the JWKS check and the IdP call that uses it follow.
const minimumLifetime = 60
const renewalTimeout = 15000

function origin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try { return new URL(value).origin }
  catch { return null }
}

function fresh(auth: IdpAuth | null): boolean {
  return !!auth && typeof auth.access_token === 'string' && !!auth.access_token && typeof auth.expires_at === 'number' && auth.expires_at > Date.now() / 1000 + minimumLifetime
}

/**
 * Reads the apes login under `home` (the owner's home directory). Pods never refreshes or writes the login itself.
 * An expired key login is renewed by running the apes CLI, which renews under its own lock. A login with a refresh
 * token is never renewed from here: the apes refresh would rewrite the login without its refresh token whenever the
 * IdP refuses the refresh, so the owner renews it by using apes.
 */
export function apesLogin(command: ApesCommand, home: string = homedir()): ApesLogin {
  const read = () => loadIdpAuth(home)
  async function token(signal: AbortSignal): Promise<{ issuer: string, accessToken: string } | null> {
    const stored = read()
    if (!stored?.access_token) return null
    const issuer = origin(stored.idp)
    if (!issuer) throw new Error('The apes login names no valid identity provider')
    if (fresh(stored)) return { issuer, accessToken: stored.access_token }
    if (stored.refresh_token) throw new Error('The apes access token expired; Pods does not renew an apes login with a refresh token, so run an apes command or apes login on this Mac')
    await renew(command, home, signal)
    const renewed = read()
    if (!renewed || !fresh(renewed) || origin(renewed.idp) !== issuer) throw new Error('The apes CLI could not renew its login')
    return { issuer, accessToken: renewed.access_token }
  }
  function signedIn(issuer: string, account: string): boolean {
    const stored = read()
    return !!stored?.access_token && origin(stored.idp) === issuer && stored.email?.trim().toLowerCase() === account.trim().toLowerCase()
  }
  return { token, signedIn }
}

// `apes whoami` renews an expired login before it prints (packages/apes/src/cli.ts maybeRefreshAuth); its output is not read.
function renew(command: ApesCommand, home: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command.executable, [command.script, 'whoami'], { env: { HOME: home, PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1' }, timeout: renewalTimeout, signal, maxBuffer: 64 * 1024 }, (error) => {
      if (error) reject(new Error('The apes CLI could not renew its login'))
      else resolve()
    })
  })
}
