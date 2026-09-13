import { authorizeAssignedCommand } from '@openape/apes/assigned'
import type { AssignedCommand } from '@openape/apes/assigned'

export interface AgentConnection {
  issuer: string
  subject: string
  owner: string
  keyId: string
  targetHost: string
  accessToken: () => Promise<string>
}
export interface AssignedAuthorization {
  command: AssignedCommand
  grantId: string
}
export class AgentAuthority {
  constructor(private readonly connection: AgentConnection) {
    const url = new URL(connection.issuer)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Invalid assigned identity origin')
  }

  private async request(path: string, method: 'GET' | 'POST', signal: AbortSignal): Promise<unknown> {
    const token = await this.connection.accessToken()
    signal.throwIfAborted()
    const response = await fetch(new URL(path, this.connection.issuer), { method, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error(`Identity authorization failed (${response.status})`)
    const text = await response.text()
    if (text.length > 128 * 1024) throw new Error('Oversized identity response')
    return JSON.parse(text) as unknown
  }

  async assertActive(grantId: string, signal: AbortSignal): Promise<void> {
    if (!/^[\w-]{1,128}$/.test(grantId)) throw new Error('Invalid assigned grant')
    const state = await this.request(`/api/pods/agents/${encodeURIComponent(this.connection.subject)}?grant=${encodeURIComponent(grantId)}`, 'GET', signal) as Record<string, unknown>
    if (!state || state.email !== this.connection.subject || state.owner !== this.connection.owner || state.active !== true || state.grantActive !== true || state.grantId !== grantId || !Array.isArray(state.keyIds) || !state.keyIds.includes(this.connection.keyId)) throw new Error('Pod identity, key or grant is no longer active')
  }

  async authorize(assignment: AssignedAuthorization, signal: AbortSignal): Promise<void> {
    await this.assertActive(assignment.grantId, signal)
    const reply = await this.request(`/api/grants/${encodeURIComponent(assignment.grantId)}/token`, 'POST', signal) as { authz_jwt?: unknown }
    if (!reply || typeof reply.authz_jwt !== 'string') throw new Error('Missing assigned grant token')
    const issuer = this.connection.issuer.replace(/\/$/, '')
    await authorizeAssignedCommand(assignment.command, reply.authz_jwt, { issuer, subject: this.connection.subject, targetHost: this.connection.targetHost, grantId: assignment.grantId, jwksUri: `${issuer}/.well-known/jwks.json`, grantsEndpoint: `${issuer}/api/grants`, signal })
  }
}
