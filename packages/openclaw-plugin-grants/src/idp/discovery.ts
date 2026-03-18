import { resolveIdP } from '@openape/core'

const _discoveryCache: Record<string, Record<string, unknown>> = {}

export function extractDomain(email: string): string {
  const parts = email.split('@')
  if (parts.length !== 2 || !parts[1])
    throw new Error(`Invalid email: ${email}`)
  return parts[1]
}

export async function discoverIdpUrl(email: string, pinnedUrl?: string): Promise<string> {
  if (pinnedUrl)
    return pinnedUrl

  const domain = extractDomain(email)
  const idpUrl = await resolveIdP(domain)
  if (!idpUrl)
    throw new Error(`No DDISA record found for domain: ${domain}`)

  return idpUrl
}

export async function discoverEndpoints(idpUrl: string): Promise<Record<string, unknown>> {
  if (_discoveryCache[idpUrl])
    return _discoveryCache[idpUrl]!

  try {
    const response = await fetch(`${idpUrl}/.well-known/openid-configuration`)
    if (response.ok) {
      const data = await response.json() as Record<string, unknown>
      _discoveryCache[idpUrl] = data
      return data
    }
  }
  catch {}

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

export async function getJwksUri(idpUrl: string): Promise<string> {
  const disco = await discoverEndpoints(idpUrl)
  return (disco.jwks_uri as string) || `${idpUrl}/.well-known/jwks.json`
}

export function clearDiscoveryCache(): void {
  for (const key of Object.keys(_discoveryCache))
    delete _discoveryCache[key]
}
