// Read the agent's identity + trust state from local files.
//
// The agent's own email + IdP, and the email of the human who owns it,
// were written into ~/.config/apes/auth.json by `apes agents spawn`.
// The contact-allowlist (peers whose contact requests the bridge will
// auto-accept) is stored alongside, in ~/.config/openape/bridge-allowlist.json.

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

function authPath(): string {
  return join(homedir(), '.config', 'apes', 'auth.json')
}

function allowlistPath(): string {
  return join(homedir(), '.config', 'openape', 'bridge-allowlist.json')
}

/**
 * Read the agent's identity from auth.json. Throws if the file is
 * missing or has no `email` — both indicate a botched spawn.
 *
 * `ownerEmail` is optional in the file shape (older spawns didn't write
 * it) but the bridge requires it for the new contact-handshake flow;
 * when missing, we throw so the daemon refuses to start rather than
 * accepting from random peers.
 */
export function readAgentIdentity(): AgentIdentity {
  const path = authPath()
  if (!existsSync(path)) {
    throw new Error(`agent identity not found at ${path}`)
  }
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw) as AuthFile
  if (!parsed.email) throw new Error(`auth.json at ${path} missing 'email'`)
  if (!parsed.owner_email) {
    throw new Error(
      `auth.json at ${path} missing 'owner_email' — re-spawn the agent with @openape/apes >= 0.28 so the owner can be tracked`,
    )
  }
  if (!parsed.idp) throw new Error(`auth.json at ${path} missing 'idp'`)
  return { email: parsed.email, ownerEmail: parsed.owner_email, idp: parsed.idp }
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
