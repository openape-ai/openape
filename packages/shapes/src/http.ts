import { getAuthToken, getIdpUrl } from './config.js'

export async function discoverEndpoints(idpUrl: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${idpUrl}/.well-known/openid-configuration`)
  if (!response.ok)
    return {}
  return response.json() as Promise<Record<string, unknown>>
}

export async function getGrantsEndpoint(idpUrl: string): Promise<string> {
  const discovery = await discoverEndpoints(idpUrl)
  return String(discovery.openape_grants_endpoint ?? `${idpUrl}/api/grants`)
}

export async function apiFetch<T>(
  path: string,
  options: {
    method?: string
    body?: unknown
    idp?: string
    token?: string
  } = {},
): Promise<T> {
  const token = options.token ?? getAuthToken()
  if (!token)
    throw new Error('Not authenticated. Run `grapes login` first.')

  const idp = options.idp ?? getIdpUrl()
  if (!path.startsWith('http') && !idp)
    throw new Error('No IdP URL configured. Use --idp or log in with grapes.')

  const url = path.startsWith('http') ? path : `${idp}${path}`
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}
