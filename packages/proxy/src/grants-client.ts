import type { OpenApeGrant, GrantType } from '@openape/core'

/**
 * Client for the IdP's grant management API.
 * Creates grant requests and polls for approval.
 */
export class GrantsClient {
  private idpUrl: string
  private agentToken: string | undefined

  constructor(idpUrl: string) {
    this.idpUrl = idpUrl.replace(/\/$/, '')
  }

  setAgentToken(token: string): void {
    this.agentToken = token
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.agentToken) {
      h['Authorization'] = `Bearer ${this.agentToken}`
    }
    return h
  }

  /**
   * Create a grant request on the IdP.
   */
  async requestGrant(opts: {
    requester: string
    targetHost: string
    audience: string
    grantType: GrantType
    permissions?: string[]
    reason?: string
    requestHash?: string
    duration?: number
  }): Promise<OpenApeGrant> {
    const res = await fetch(`${this.idpUrl}/api/grants`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        requester: opts.requester,
        target_host: opts.targetHost,
        audience: opts.audience,
        grant_type: opts.grantType,
        permissions: opts.permissions,
        reason: opts.reason,
        request_hash: opts.requestHash,
        duration: opts.duration,
      }),
    })

    if (!res.ok) {
      throw new Error(`Grant request failed: ${res.status} ${await res.text()}`)
    }

    return res.json() as Promise<OpenApeGrant>
  }

  /**
   * Poll a grant until it's approved, denied, or timeout.
   */
  async waitForApproval(
    grantId: string,
    timeoutMs: number = 300_000,
    pollIntervalMs: number = 2_000,
  ): Promise<OpenApeGrant> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const res = await fetch(`${this.idpUrl}/api/grants/${grantId}`, {
        headers: this.headers(),
      })

      if (!res.ok) {
        throw new Error(`Grant poll failed: ${res.status}`)
      }

      const grant = await res.json() as OpenApeGrant
      if (grant.status !== 'pending') {
        return grant
      }

      await new Promise(r => setTimeout(r, pollIntervalMs))
    }

    throw new Error(`Grant approval timed out after ${timeoutMs}ms`)
  }

  /**
   * Check if there's an existing approved grant for a host+audience+permissions combo.
   * Ignores `once` grants (they're single-use).
   */
  async findExistingGrant(
    requester: string,
    targetHost: string,
    audience: string,
    permissions?: string[],
  ): Promise<OpenApeGrant | null> {
    const params = new URLSearchParams({
      requester,
      status: 'approved',
    })

    const res = await fetch(`${this.idpUrl}/api/grants?${params}`, {
      headers: this.headers(),
    })

    if (!res.ok) return null

    const grants = await res.json() as OpenApeGrant[]
    const now = Math.floor(Date.now() / 1000)

    return grants.find((g) => {
      if (g.status !== 'approved') return false
      if (g.expires_at && g.expires_at <= now) return false
      if (g.request?.grant_type === 'once') return false
      if (g.request?.target_host !== targetHost) return false
      if (g.request?.audience !== audience) return false
      if (permissions?.length && g.request?.permissions?.length) {
        const grantedPerms = new Set(g.request.permissions)
        if (!permissions.every(p => grantedPerms.has(p))) return false
      }
      return true
    }) ?? null
  }
}
