import { useRuntimeConfig, useEvent } from 'nitropack/runtime'
import { useIdpStorage } from './storage'

export interface FederationProvider {
  id: string
  type: 'oidc'
  issuer: string
  clientId: string
  clientSecret: string
  scopes?: string[]
}

interface OidcDiscovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint?: string
  jwks_uri: string
}

interface FederationFlowState {
  providerId: string
  codeVerifier: string
  state: string
  returnTo?: string
  createdAt: number
}

const discoveryCache = new Map<string, { data: OidcDiscovery, expiresAt: number }>()

export function getFederationProviders(): FederationProvider[] {
  let raw: string | undefined

  try {
    const event = useEvent()
    raw = event?.context?.openapeFederationProviders as string | undefined
  }
  catch {}

  if (!raw) {
    const config = useRuntimeConfig()
    raw = (config.openapeIdp as Record<string, unknown>)?.federationProviders as string | undefined
  }

  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p: unknown): p is FederationProvider =>
        typeof p === 'object' && p !== null
        && typeof (p as Record<string, unknown>).id === 'string'
        && typeof (p as Record<string, unknown>).issuer === 'string'
        && typeof (p as Record<string, unknown>).clientId === 'string',
    )
  }
  catch {
    return []
  }
}

export function findProvider(providerId: string): FederationProvider | null {
  const providers = getFederationProviders()
  return providers.find(p => p.id === providerId) ?? null
}

export async function fetchOidcDiscovery(issuer: string): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(issuer)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch OIDC discovery from ${url}: ${response.status}`)
  }

  const data = await response.json() as OidcDiscovery
  discoveryCache.set(issuer, { data, expiresAt: Date.now() + 3600_000 })
  return data
}

export async function saveFederationState(state: string, flow: FederationFlowState): Promise<void> {
  const storage = useIdpStorage()
  await storage.setItem(`federation-state:${state}`, flow)
}

export async function consumeFederationState(state: string): Promise<FederationFlowState | null> {
  const storage = useIdpStorage()
  const flow = await storage.getItem<FederationFlowState>(`federation-state:${state}`)
  if (flow) {
    await storage.removeItem(`federation-state:${state}`)
  }
  return flow
}

export async function exchangeCodeForTokens(
  provider: FederationProvider,
  tokenEndpoint: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<{ id_token?: string, access_token: string }> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code_verifier: codeVerifier,
  })

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token exchange failed: ${response.status} ${text}`)
  }

  return response.json() as Promise<{ id_token?: string, access_token: string }>
}

export async function fetchUserInfo(
  userinfoEndpoint: string,
  accessToken: string,
): Promise<{ sub: string, email?: string, name?: string }> {
  const response = await fetch(userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Userinfo fetch failed: ${response.status}`)
  }

  return response.json() as Promise<{ sub: string, email?: string, name?: string }>
}
