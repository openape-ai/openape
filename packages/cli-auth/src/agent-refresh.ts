import { Buffer } from 'node:buffer'
import { sign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ofetch } from 'ofetch'
import { loadEd25519PrivateKey } from './ssh-key.js'
import type { IdpAuth } from './types.js'

interface DiscoveryDocument {
  ddisa_agent_challenge_endpoint?: string
  ddisa_agent_authenticate_endpoint?: string
}

interface ChallengeResponse {
  challenge: string
}

interface AuthenticateResponse {
  token: string
  expires_in: number
}

async function getEndpoints(idp: string): Promise<{ challenge: string, authenticate: string }> {
  let disco: DiscoveryDocument = {}
  try {
    disco = await ofetch<DiscoveryDocument>(`${idp}/.well-known/openid-configuration`)
  }
  catch {
    // Fall through to convention-based paths — the IdP usually exposes both,
    // but a missing discovery doc shouldn't block a key-based refresh.
  }
  return {
    challenge: disco.ddisa_agent_challenge_endpoint ?? `${idp}/api/agent/challenge`,
    authenticate: disco.ddisa_agent_authenticate_endpoint ?? `${idp}/api/agent/authenticate`,
  }
}

function resolveKeyPath(p: string): string {
  if (p.startsWith('~')) return join(homedir(), p.slice(1))
  return p
}

/**
 * Resolve the signing key for an agent refresh.
 *
 * Order:
 *   1. `auth.key_path` (set by `apes login --key …` once it persists)
 *   2. `~/.ssh/id_ed25519` if present (default for `apes agents spawn`,
 *      which writes the agent's keypair there).
 *
 * Returns `null` when no key is available — caller falls back to
 * `NotLoggedInError` so the consuming CLI can surface the right hint.
 */
function findSigningKey(auth: IdpAuth): { keyPath: string, keyContent: string } | null {
  const candidates: string[] = []
  if (auth.key_path) candidates.push(resolveKeyPath(auth.key_path))
  candidates.push(join(homedir(), '.ssh', 'id_ed25519'))

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return { keyPath: p, keyContent: readFileSync(p, 'utf-8') }
      }
      catch {
        // Permission denied / unreadable — try the next candidate.
      }
    }
  }
  return null
}

/**
 * Refresh an agent's IdP token via Ed25519 challenge-response.
 *
 * Why this exists: agent IdP tokens are minted by the IdP's
 * `/agent/authenticate` endpoint and have **no** refresh_token (the
 * spec deliberately keeps agent auth challenge-only — no long-lived
 * bearer to leak). The OAuth refresh-token grant in
 * `ensureFreshIdpAuth` therefore can't recover an expired agent token,
 * which left the chat-bridge daemon in a 1-hour crash-restart loop
 * (see issue #259). This function plugs the gap by re-running the
 * same challenge-response flow `apes login --key` does — entirely
 * in-process, no `apes` shell-out, no daemon restart.
 *
 * Returns `null` when refresh isn't possible (no key on disk, IdP
 * rejected, network error). The caller is `ensureFreshIdpAuth`,
 * which then falls back to `NotLoggedInError`.
 */
export async function refreshAgentToken(
  auth: IdpAuth,
  now: number = Math.floor(Date.now() / 1000),
): Promise<IdpAuth | null> {
  const key = findSigningKey(auth)
  if (!key) return null

  let privateKey
  try {
    privateKey = loadEd25519PrivateKey(key.keyContent)
  }
  catch {
    return null
  }

  let endpoints
  try {
    endpoints = await getEndpoints(auth.idp)
  }
  catch {
    return null
  }

  let challenge: string
  try {
    const resp = await ofetch<ChallengeResponse>(endpoints.challenge, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { agent_id: auth.email },
    })
    challenge = resp.challenge
  }
  catch {
    return null
  }

  let signature: string
  try {
    signature = sign(null, Buffer.from(challenge), privateKey).toString('base64')
  }
  catch {
    return null
  }

  let authResp: AuthenticateResponse
  try {
    authResp = await ofetch<AuthenticateResponse>(endpoints.authenticate, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { agent_id: auth.email, challenge, signature },
    })
  }
  catch {
    return null
  }

  return {
    ...auth,
    access_token: authResp.token,
    expires_at: now + (authResp.expires_in || 3600),
    key_path: auth.key_path ?? key.keyPath,
  }
}
