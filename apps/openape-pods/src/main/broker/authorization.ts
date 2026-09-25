import type { BrokeredGrant } from '@openape/core'
import { sameBrokeredGrant } from '@openape/grants'
import { authorizeAssignedCommand } from '@openape/apes/assigned'
import type { AssignedCommand } from '@openape/apes/assigned'
import type { RunApproval } from '../../contracts/activity'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { setTimeout as delay } from 'node:timers/promises'

export type GrantProgress = RunApproval
export type GrantObserver = (progress: GrantProgress) => Promise<void>
export type GrantLookup = (permission: string, connection: AgentConnection) => Promise<string | undefined>
interface Grant { brokered?: BrokeredGrant, id: string, status: string, request: { requester: string, audience: string, target_host: string, grant_type: string } }

export interface AgentConnection {
  decisionIssuer?: string
  brokered?: BrokeredGrant
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
  constructor(private readonly connection: AgentConnection, private readonly observe?: GrantObserver, private readonly previous?: GrantLookup) {
    const url = new URL(connection.issuer)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Invalid assigned identity origin')
  }

  private async request(path: string, method: 'GET' | 'POST', signal: AbortSignal, body?: unknown): Promise<unknown> {
    const token = await this.connection.accessToken()
    signal.throwIfAborted()
    const response = await fetch(new URL(path, this.connection.issuer), { method, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!response.body) throw new Error('Identity service returned no response')
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break
        size += next.value.byteLength
        if (size > 128 * 1024) throw new Error('Oversized identity response')
        chunks.push(next.value)
      }
    }
    finally { await reader.cancel(); reader.releaseLock() }
    const text = Buffer.concat(chunks).toString('utf8')
    if (!response.ok) {
      let category = ''
      try { const problem = JSON.parse(text); const type = problem.type ?? problem.data?.type; category = type === 'https://openape.org/errors/grant_not_approved' ? 'grant_not_approved' : '' }
      catch { category = '' }
      if (category === 'grant_not_approved') throw new Error('The grant is no longer approved; review its current status before retrying')
      if (response.status === 401) throw new Error('OpenApe authentication expired; reconnect the Pod owner in App settings')
      if (response.status === 403) throw new Error('OpenApe rejected this Pod identity; check its assigned owner and permissions')
      throw new Error(`The permission service rejected the request (${response.status}); inspect the grant before retrying`)
    }
    return JSON.parse(text) as unknown
  }

  private async grant(id: string, signal: AbortSignal): Promise<Grant> {
    if (!/^[\w-]{1,128}$/.test(id)) throw new Error('Invalid assigned grant')
    const grant = await this.request(`/api/grants/${encodeURIComponent(id)}`, 'GET', signal) as Grant
    if (!grant || grant.id !== id || !['pending', 'approved', 'used', 'expired', 'denied', 'revoked'].includes(grant.status) || grant.request?.requester !== this.connection.subject || grant.request.audience !== 'shapes' || grant.request.target_host !== this.connection.targetHost) throw new Error('Grant does not belong to this Pod and execution target')
    if (!sameBrokeredGrant(grant.brokered, this.connection.brokered)) throw new Error('Grant broker binding differs from the assigned identity')
    return grant
  }

  async acquire(assignment: AssignedAuthorization, signal: AbortSignal, summary?: string): Promise<string> {
    const adapter = loadAdapter(assignment.command.cliId, assignment.command.adapterPath)
    if (adapter.digest !== assignment.command.adapterDigest) throw new Error('Assigned adapter integrity mismatch')
    const resolved = await resolveCommand(adapter, assignment.command.argv)
    if (resolved.permission !== assignment.command.permission || resolved.detail.operation_id === '_generic.exec') throw new Error('Command is outside the assigned operation')
    let grant = assignment.grantId ? await this.grant(assignment.grantId, signal) : undefined
    if (!grant || ['used', 'expired'].includes(grant.status)) {
      const previousId = await this.previous?.(resolved.permission, this.connection)
      if (previousId && previousId !== grant?.id) grant = await this.grant(previousId, signal)
    }
    if (grant && ['denied', 'revoked'].includes(grant.status)) throw new Error(`Permission ${grant.status}; review this Pod's permissions before retrying`)
    if (!grant || grant.status === 'used' || grant.status === 'expired') {
      const created = await this.request('/api/grants', 'POST', signal, { requester: this.connection.subject, target_host: this.connection.targetHost, audience: 'shapes', grant_type: assignment.command.cliId === 'pod-runtime' ? 'always' : 'once', waits_until: Math.floor(Date.now() / 1000) + 15 * 60, command: assignment.command.argv, permissions: [resolved.permission], authorization_details: [resolved.detail], execution_context: resolved.executionContext, reason: resolved.detail.display, ...(summary ? { summary: { text: summary } } : {}) }) as { id?: unknown }
      if (typeof created?.id !== 'string') throw new Error('Permission service returned an invalid grant')
      grant = await this.grant(created.id, signal)
    }
    const current = grant
    const publish = async (state: GrantProgress['state']) => this.observe?.({ grantId: current.id, issuer: this.connection.decisionIssuer ?? this.connection.issuer, title: resolved.detail.display, permission: resolved.permission, subject: this.connection.subject, state })
    if (grant.status === 'pending') {
      if (!this.observe) throw new Error('Permission needs owner approval; open this Pod in OpenApe Pods')
      await publish('pending')
      const deadline = Date.now() + 15 * 60 * 1000
      try {
        while (grant.status === 'pending' && Date.now() < deadline) {
          await delay(1000, undefined, { signal })
          grant = await this.grant(grant.id, signal)
        }
      }
      catch (error) { await publish('cancelled'); throw error }
      if (grant.status !== 'approved') await publish(grant.status === 'denied' ? 'denied' : grant.status === 'revoked' ? 'revoked' : 'expired')
    }
    if (grant.status !== 'approved') throw new Error(grant.status === 'pending' || grant.status === 'expired' ? 'Permission approval expired; start a new run when you are ready to approve it' : `Permission ${grant.status}; review this Pod's permissions before retrying`)
    await publish('approved')
    return grant.id
  }

  async assertActive(grantId: string, signal: AbortSignal): Promise<void> {
    if (!/^[\w-]{1,128}$/.test(grantId)) throw new Error('Invalid assigned grant')
    const state = await this.request(`/api/pods/agents/${encodeURIComponent(this.connection.subject)}?grant=${encodeURIComponent(grantId)}`, 'GET', signal) as Record<string, unknown>
    if (!state || state.email !== this.connection.subject || state.owner !== this.connection.owner || state.active !== true || state.grantActive !== true || state.grantId !== grantId || !Array.isArray(state.keyIds) || !state.keyIds.includes(this.connection.keyId)) throw new Error('Pod identity, key or grant is no longer active')
  }

  async authorize(assignment: AssignedAuthorization, signal: AbortSignal, summary?: string): Promise<void> {
    assignment.grantId = await this.acquire(assignment, signal, summary)
    await this.assertActive(assignment.grantId, signal)
    const reply = await this.request(`/api/grants/${encodeURIComponent(assignment.grantId)}/token`, 'POST', signal) as { authz_jwt?: unknown }
    if (!reply || typeof reply.authz_jwt !== 'string') throw new Error('Missing assigned grant token')
    const issuer = (this.connection.decisionIssuer ?? this.connection.issuer).replace(/\/$/, '')
    await authorizeAssignedCommand(assignment.command, reply.authz_jwt, { issuer, brokered: this.connection.brokered, subject: this.connection.subject, targetHost: this.connection.targetHost, grantId: assignment.grantId, jwksUri: `${issuer}/.well-known/jwks.json`, grantsEndpoint: `${issuer}/api/grants`, signal })
  }
}
