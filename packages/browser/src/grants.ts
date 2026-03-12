import type { AgentConfig, GrantRequest, RuleApproval } from './types'

const POLL_INTERVAL = 3000
const POLL_TIMEOUT = 300_000

export interface GrantRequestParams {
  type: string
  url: string
  method: string
  bodyHash?: string
  reason: string
  approval: RuleApproval
}

/**
 * Resolve the IdP URL from agent config.
 * Extracts domain from agent email if no explicit IdP is set.
 */
export function resolveIdpUrl(idp: string | undefined, agent: AgentConfig): string {
  if (idp)
    return idp

  // Extract IdP domain from agent email: agent+user@idp.example.com → https://idp.example.com
  const atIndex = agent.email.indexOf('@')
  if (atIndex !== -1) {
    const domain = agent.email.slice(atIndex + 1)
    return `https://${domain}`
  }

  throw new Error('Cannot resolve IdP URL: provide idp option or use agent email with domain')
}

/**
 * Get authorization headers for IdP API calls.
 */
function authHeaders(agent: AgentConfig): Record<string, string> {
  if (agent.token) {
    return { Authorization: `Bearer ${agent.token}` }
  }
  return {}
}

/**
 * Request a grant from the IdP.
 */
export async function requestGrant(
  idpUrl: string,
  agent: AgentConfig,
  params: GrantRequestParams,
): Promise<GrantRequest> {
  const response = await fetch(`${idpUrl}/api/grants`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(agent),
    },
    body: JSON.stringify({
      type: params.type,
      action: `${params.method} ${params.url}`,
      reason: params.reason,
      approval: params.approval,
      metadata: {
        url: params.url,
        method: params.method,
        ...(params.bodyHash ? { body_hash: params.bodyHash } : {}),
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Grant request failed: ${response.status} ${response.statusText}`)
  }

  return await response.json() as GrantRequest
}

/**
 * Check grant status.
 */
export async function checkGrantStatus(
  idpUrl: string,
  agent: AgentConfig,
  grantId: string,
): Promise<GrantRequest> {
  const response = await fetch(`${idpUrl}/api/grants/${grantId}`, {
    headers: authHeaders(agent),
  })

  if (!response.ok) {
    throw new Error(`Grant status check failed: ${response.status}`)
  }

  return await response.json() as GrantRequest
}

/**
 * Wait for a grant to be approved or denied.
 * Polls the IdP at regular intervals.
 */
export async function waitForApproval(
  idpUrl: string,
  agent: AgentConfig,
  grantId: string,
): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT

  while (Date.now() < deadline) {
    const grant = await checkGrantStatus(idpUrl, agent, grantId)

    if (grant.status === 'approved')
      return true
    if (grant.status === 'denied' || grant.status === 'revoked')
      return false

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL))
  }

  return false
}
