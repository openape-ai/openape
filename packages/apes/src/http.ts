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

export async function apiFetch<T = unknown>(
  path: string,
  options: {
    method?: string
    body?: unknown
    idp?: string
    token?: string
  } = {},
): Promise<T> {
  let token = options.token || getAuthToken()

  // Auto-refresh expired agent tokens
  if (!token) {
    token = await refreshAgentToken()
  }

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
        const message = (problem.detail as string) || (problem.title as string) || `${response.status} ${response.statusText}`
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
