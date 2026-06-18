// Read the agent's identity + trust state from local files.
//
// The agent's own email + IdP, and the email of the human who owns it,
// are written into ~/.config/apes/auth.json at spawn time by
// `apes agents spawn`. The contact-allowlist (peers whose contact
// requests the bridge will auto-accept) is stored alongside, in
// ~/.config/openape/bridge-allowlist.json.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface AgentIdentity {
  email: string
  ownerEmail: string
  idp: string
}

interface AuthFile {
  email?: string
  owner_email?: string
  idp?: string
}

interface AllowlistFile {
  /** Peer emails the bridge auto-accepts contact requests from. */
  emails: string[]
}

function authPath(home: string): string {
  return join(home, '.config', 'apes', 'auth.json')
}

function allowlistPath(): string {
  return join(homedir(), '.config', 'openape', 'bridge-allowlist.json')
}

/**
 * Read the agent's identity from auth.json. Throws if the file is
 * missing or has no `email` — both indicate a botched spawn.
 *
 * `owner_email` is written by `apes agents spawn`. If it's missing we
 * fall back to `OPENAPE_OWNER_EMAIL` from the container environment
 * (compose `environment:` block) so an old auth.json that pre-dates
 * Phase A doesn't strand the bridge in a crash loop. If both are
 * missing we throw — the bridge requires it for the contact handshake.
 *
 * `home` defaults to the running process's home, which is the bin path's
 * behaviour (each per-agent bridge ran as its own OS user). The nest's
 * in-process SessionHost passes the registry entry's `home` so one daemon
 * can read each hosted agent's identity from that agent's own home.
 */
export function readAgentIdentity(home = homedir()): AgentIdentity {
  const path = authPath(home)
  if (!existsSync(path)) {
    throw new Error(`agent identity not found at ${path}`)
  }
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw) as AuthFile
  if (!parsed.email) throw new Error(`auth.json at ${path} missing 'email'`)
  if (!parsed.idp) throw new Error(`auth.json at ${path} missing 'idp'`)
  const ownerEmail = parsed.owner_email ?? process.env.OPENAPE_OWNER_EMAIL
  if (!ownerEmail) {
    throw new Error(
      `auth.json at ${path} missing 'owner_email' and no OPENAPE_OWNER_EMAIL env var set — `
      + 're-spawn the agent with @openape/apes >= 0.28 or set OPENAPE_OWNER_EMAIL in the container env',
    )
  }
  return { email: parsed.email, ownerEmail, idp: parsed.idp }
}

/**
 * Read the bridge's contact-allowlist. Returns the deduplicated
 * lower-cased set of emails the bridge will auto-accept from. The
 * owner is always included implicitly by `accept-policy` callers — the
 * file only needs to list additional peers `apes agents allow` has
 * approved.
 */
export function readAllowlist(): Set<string> {
  const path = allowlistPath()
  if (!existsSync(path)) return new Set()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AllowlistFile
    if (!Array.isArray(parsed.emails)) return new Set()
    return new Set(parsed.emails.map(e => e.toLowerCase()))
  }
  catch {
    return new Set()
  }
}

/**
 * Decide whether the bridge should auto-accept a pending contact
 * request from `peerEmail` for the agent identified by `identity`.
 *
 * Pure function over the inputs — easy to unit-test the policy.
 */
export function shouldAutoAccept(
  peerEmail: string,
  identity: AgentIdentity,
  allowlist: Set<string>,
): boolean {
  const peer = peerEmail.toLowerCase()
  if (peer === identity.ownerEmail.toLowerCase()) return true
  return allowlist.has(peer)
}
