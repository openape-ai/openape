import { getAuthToken, getIdpUrl } from './config'

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

export async function apiFetch<T = unknown>(
  path: string,
  options: {
    method?: string
    body?: unknown
    idp?: string
    token?: string
  } = {},
): Promise<T> {
  const token = options.token || getAuthToken()
  if (!token) {
    throw new Error('Not authenticated. Run `grapes login` first.')
  }

  let url: string
  if (path.startsWith('http')) {
    url = path
  } else {
    const idp = options.idp || getIdpUrl()
    if (!idp) {
      throw new Error('No IdP URL configured. Run `grapes login` first or pass --idp.')
    }
    url = `${idp}${path}`
  }
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

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
        if (e instanceof ApiError) throw e
      }
    }

    const text = await response.text()
    throw new ApiError(response.status, text || `${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}
