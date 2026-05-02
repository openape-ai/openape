import consola from 'consola'
import { getAuthToken, getIdpUrl, loadAuth, loadConfig, saveAuth } from './config'

const debug = process.argv.includes('--debug')

export class ApiError extends Error {
  constructor(public statusCode: number, message: string, public problemDetails?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
  }
}

// OIDC Discovery cache (one-time per CLI invocation)
const _discoveryCache: Record<string, Record<string, unknown>> = {}

export async function discoverEndpoints(idpUrl: string): Promise<Record<string, unknown>> {
  if (_discoveryCache[idpUrl]) {
    return _discoveryCache[idpUrl]
  }

  try {
    const response = await fetch(`${idpUrl}/.well-known/openid-configuration`)
    if (response.ok) {
      const data = await response.json() as Record<string, unknown>
      _discoveryCache[idpUrl] = data
      return data
    }
  }
  catch {}

  // Return empty if discovery fails (graceful degradation)
  _discoveryCache[idpUrl] = {}
  return {}
}

export async function getGrantsEndpoint(idpUrl: string): Promise<string> {
  const disco = await discoverEndpoints(idpUrl)
  return (disco.openape_grants_endpoint as string) || `${idpUrl}/api/grants`
}

export async function getAgentChallengeEndpoint(idpUrl: string): Promise<string> {
  const disco = await discoverEndpoints(idpUrl)
  return (disco.ddisa_agent_challenge_endpoint as string) || `${idpUrl}/api/agent/challenge`
}

export async function getAgentAuthenticateEndpoint(idpUrl: string): Promise<string> {
  const disco = await discoverEndpoints(idpUrl)
  return (disco.ddisa_agent_authenticate_endpoint as string) || `${idpUrl}/api/agent/authenticate`
}

export async function getDelegationsEndpoint(idpUrl: string): Promise<string> {
  const disco = await discoverEndpoints(idpUrl)
  return (disco.openape_delegations_endpoint as string) || `${idpUrl}/api/delegations`
}

/**
 * Re-authenticate an agent using Ed25519 challenge-response.
 * Called automatically when the token is expired.
 */
async function refreshAgentToken(): Promise<string | null> {
  const auth = loadAuth()
  if (!auth)
    return null

  const config = loadConfig()
  const keyPath = config.agent?.key
  if (!keyPath)
    return null

  try {
    const { readFileSync } = await import('node:fs')
    const { sign } = await import('node:crypto')
    const { homedir } = await import('node:os')
    const { loadEd25519PrivateKey } = await import('./ssh-key.js')

    const resolved = keyPath.replace(/^~/, homedir())
    const keyContent = readFileSync(resolved, 'utf-8')
    const privateKey = loadEd25519PrivateKey(keyContent)

    const challengeUrl = await getAgentChallengeEndpoint(auth.idp)
    const challengeResp = await fetch(challengeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: auth.email }),
    })

    if (!challengeResp.ok)
      return null

    const { challenge } = await challengeResp.json() as { challenge: string }
    const { Buffer } = await import('node:buffer')
    const signature = sign(null, Buffer.from(challenge), privateKey).toString('base64')

    const authenticateUrl = await getAgentAuthenticateEndpoint(auth.idp)
    const authResp = await fetch(authenticateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: auth.email, challenge, signature }),
    })

    if (!authResp.ok)
      return null

    const { token, expires_in } = await authResp.json() as { token: string, expires_in: number }

    saveAuth({
      ...auth,
      access_token: token,
      expires_at: Math.floor(Date.now() / 1000) + (expires_in || 3600),
    })

    if (debug) {
      consola.debug('Token refreshed via Ed25519 challenge-response')
    }

    return token
  }
  catch {
    return null
  }
}

/**
 * Refresh an OAuth2 access token using a stored refresh_token. Used for
 * PKCE/browser login sessions where no Ed25519 agent key is configured.
 *
 * Serialized via a file lock so concurrent apes/ape-shell invocations don't
 * both consume the same rotating refresh token (which would revoke the
 * entire family server-side).
 */
async function refreshOAuthToken(): Promise<string | null> {
  const auth = loadAuth()
  if (!auth?.refresh_token)
    return null

  const { acquireAuthLock, releaseAuthLock } = await import('./auth-lock.js')
  const lock = await acquireAuthLock({ timeoutMs: 5000 })
  if (!lock) {
    // Another process is refreshing. It should have updated auth.json by now;
    // re-read and return whatever fresh token is there (may still be null).
    return getAuthToken()
  }

  try {
    // Re-read auth.json inside the lock — another holder may already have
    // refreshed while we were waiting, in which case we reuse the new token.
    const latest = loadAuth()
    if (latest?.expires_at && Date.now() / 1000 < latest.expires_at - 30)
      return latest.access_token

    const activeRefreshToken = latest?.refresh_token ?? auth.refresh_token
    if (!activeRefreshToken)
      return null

    const disco = await discoverEndpoints(auth.idp)
    const tokenEndpoint = (disco.token_endpoint as string) || `${auth.idp}/token`

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: activeRefreshToken,
    })

    const resp = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!resp.ok) {
      // Family may have been revoked server-side — clear refresh_token to
      // prevent an infinite retry loop on every subsequent apes invocation.
      if (resp.status === 400 || resp.status === 401) {
        const base = latest ?? auth
        saveAuth({ ...base, refresh_token: undefined })
      }
      return null
    }

    const tokens = await resp.json() as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }

    const base = latest ?? auth
    saveAuth({
      ...base,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? base.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in || 300),
    })

    if (debug)
      consola.debug('Token refreshed via OAuth refresh_token')

    return tokens.access_token
  }
  finally {
    await releaseAuthLock(lock)
  }
}

/**
 * Refresh the local IdP token if it has expired. Used by every code path
 * that needs an access token — `apiFetch` for IdP-bound HTTP calls, plus
 * any pure-introspection command (`apes whoami`, `apes config get …`)
 * that previously only read local auth state and surfaced a stale
 * "expired" without attempting renewal.
 *
 * Returns the fresh access token on success, or null when no refresh
 * path is available (no agent key AND no refresh_token, or both refresh
 * attempts failed). Callers decide what to do with null — `apiFetch`
 * throws "Not authenticated", `whoami` falls back to the on-disk state.
 */
export async function ensureFreshToken(): Promise<string | null> {
  const cached = getAuthToken()
  if (cached) return cached

  // Auto-refresh: priority (1) ed25519 agent key, (2) OAuth refresh_token.
  // Agent-key first because it is concurrency-safe — every challenge is
  // independent server-side, so parallel ape-shell spawns don't race.
  const agentToken = await refreshAgentToken()
  if (agentToken) return agentToken
  const oauthToken = await refreshOAuthToken()
  return oauthToken ?? null
}

export async function apiFetch<T = unknown>(
  path: string,
  options: {
    method?: string
    body?: unknown
    idp?: string
    token?: string
  } = {},
): Promise<T> {
  const token = options.token ?? await ensureFreshToken()

  if (!token) {
    throw new Error('Not authenticated (token expired). Run `apes login` first.')
  }

  let url: string
  if (path.startsWith('http')) {
    url = path
  }
  else {
    const idp = options.idp || getIdpUrl()
    if (!idp) {
      throw new Error('No IdP URL configured. Run `apes login` first or pass --idp.')
    }
    url = `${idp}${path}`
  }
  const method = options.method || 'GET'
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  if (debug) {
    consola.debug(`${method} ${url}`)
    consola.debug(`Token: ${token.substring(0, 20)}...${token.substring(token.length - 10)}`)
  }

  const response = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (debug) {
    consola.debug(`Response: ${response.status} ${response.statusText}`)
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || ''

    // Parse RFC 7807 Problem Details
    if (contentType.includes('application/problem+json') || contentType.includes('application/json')) {
      try {
        const problem = await response.json() as Record<string, unknown>
        const message = (problem.detail as string) || (problem.title as string) || (problem.statusMessage as string) || (problem.message as string) || `${response.status} ${response.statusText}`
        throw new ApiError(response.status, message, problem)
      }
      catch (e) {
        if (e instanceof ApiError)
          throw e
      }
    }

    const text = await response.text()
    throw new ApiError(response.status, text || `${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}
