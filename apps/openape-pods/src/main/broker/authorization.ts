import { AuthorityError, transientNetwork, transientResponse  } from '../../contracts/infrastructure'
import type { BrokeredGrant } from '@openape/core'
import { sameBrokeredGrant } from '@openape/grants'
import type { VerifyAuthzOptions } from '@openape/grants'
import { authorizeAssignedCommand } from '@openape/apes/assigned'
import type { AssignedCommand } from '@openape/apes/assigned'
import type { RunApproval } from '../../contracts/activity'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { setTimeout as delay } from 'node:timers/promises'

export type GrantProgress = RunApproval
export type GrantObserver = (progress: GrantProgress, automatic?: boolean) => Promise<void>
export type GrantApproval = (grantId: string, signal: AbortSignal) => Promise<boolean>
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
interface MintedGrant { grantId: string, token: string, jwks: VerifyAuthzOptions['jwks'], reusableUntil: number }
export const grantTokenReuseMs = 60 * 1000
const expiryMarginMs = 10 * 1000

/**
 * Grant tokens minted during one run. A reusable (non-single-use) token is
 * re-verified locally for later calls for at most one minute, and never past
 * shortly before its own expiry, so a run contacts the identity provider at
 * most once per grant and minute instead of once per call.
 */
export class RunGrantTokens {
  private readonly minted = new Map<string, MintedGrant>()
  reusable(key: string, now = Date.now()): MintedGrant | undefined {
    const entry = this.minted.get(key)
    if (entry && now < entry.reusableUntil) return entry
    this.minted.delete(key)
    return undefined
  }

  remember(key: string, grant: { grantId: string, token: string, jwks: VerifyAuthzOptions['jwks'], expiresAt: number }, now = Date.now()): void {
    this.minted.set(key, { grantId: grant.grantId, token: grant.token, jwks: grant.jwks, reusableUntil: Math.min(now + grantTokenReuseMs, grant.expiresAt - expiryMarginMs) })
  }

  expired(now = Date.now()): boolean { return [...this.minted.keys()].every(key => !this.reusable(key, now)) }
}

function tokenClaims(token: string): { exp: number, grantType: string } {
  const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: unknown, grant_type?: unknown, approval?: unknown }
  if (typeof claims.exp !== 'number') throw new Error('Grant token has no expiry')
  return { exp: claims.exp, grantType: claims.grant_type === 'once' || claims.approval === 'once' ? 'once' : String(claims.grant_type) }
}

export class AgentAuthority {
  constructor(private readonly connection: AgentConnection, private readonly observe?: GrantObserver, private readonly previous?: GrantLookup, private readonly approve?: GrantApproval, private readonly tokens?: RunGrantTokens) {
    const url = new URL(connection.issuer)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Invalid assigned identity origin')
  }

  private async request(path: string, method: 'GET' | 'POST', signal: AbortSignal, body?: unknown): Promise<unknown> {
    const token = await this.connection.accessToken()
    signal.throwIfAborted()
    const safe = method === 'GET' || path.endsWith('/token')
    let response: Response
    try { response = await fetch(new URL(path, this.connection.issuer), { method, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
    catch (error) { if (safe) transientNetwork(error, 'authorization', signal); throw error }
    try { transientResponse(response, 'authorization') }
    catch (error) { await response.body?.cancel(); throw error }
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
      if (category === 'grant_not_approved') throw new AuthorityError('The grant is no longer approved; review its current status before retrying')
      if (response.status === 401) throw new AuthorityError('OpenApe authentication expired; reconnect the Pod owner in App settings')
      if (response.status === 403) throw new AuthorityError('OpenApe rejected this Pod identity; check its assigned owner and permissions')
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
    if (grant && ['denied', 'revoked'].includes(grant.status)) throw new AuthorityError(`Permission ${grant.status}; review this Pod's permissions before retrying`)
    if (!grant || grant.status === 'used' || grant.status === 'expired') {
      const created = await this.request('/api/grants', 'POST', signal, { requester: this.connection.subject, target_host: this.connection.targetHost, audience: 'shapes', grant_type: assignment.command.cliId === 'pod-runtime' ? 'always' : 'once', waits_until: Math.floor(Date.now() / 1000) + 15 * 60, command: assignment.command.argv, permissions: [resolved.permission], authorization_details: [resolved.detail], execution_context: resolved.executionContext, reason: resolved.detail.display, ...(summary ? { summary: { text: summary } } : {}) }) as { id?: unknown }
      if (typeof created?.id !== 'string') throw new Error('Permission service returned an invalid grant')
      grant = await this.grant(created.id, signal)
    }
    const current = grant
    const publish = async (state: GrantProgress['state'], automatic = false) => this.observe?.({ grantId: current.id, issuer: this.connection.decisionIssuer ?? this.connection.issuer, title: resolved.detail.display, permission: resolved.permission, subject: this.connection.subject, state }, automatic)
    if (grant.status === 'pending' && assignment.command.cliId === 'pod-runtime' && this.approve) {
      await publish('pending', true)
      if (await this.approve(grant.id, signal)) {
        grant = await this.grant(grant.id, signal)
        if (grant.status !== 'approved') throw new Error(`Automatic runtime permission approval failed (${grant.status})`)
      }
    }
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
    if (grant.status !== 'approved') throw new AuthorityError(grant.status === 'pending' || grant.status === 'expired' ? 'Permission approval expired; start a new run when you are ready to approve it' : `Permission ${grant.status}; review this Pod's permissions before retrying`)
    await publish('approved')
    return grant.id
  }

  async assertActive(grantId: string, signal: AbortSignal): Promise<void> {
    if (!/^[\w-]{1,128}$/.test(grantId)) throw new Error('Invalid assigned grant')
    const state = await this.request(`/api/pods/agents/${encodeURIComponent(this.connection.subject)}?grant=${encodeURIComponent(grantId)}`, 'GET', signal) as Record<string, unknown>
    if (!state || state.email !== this.connection.subject || state.owner !== this.connection.owner || state.active !== true || state.grantActive !== true || state.grantId !== grantId || !Array.isArray(state.keyIds) || !state.keyIds.includes(this.connection.keyId)) throw new AuthorityError('Pod identity, key or grant is no longer active')
  }

  async authorize(assignment: AssignedAuthorization, signal: AbortSignal, summary?: string): Promise<void> {
    const key = [this.connection.subject, this.connection.targetHost, this.connection.keyId, assignment.command.cliId, assignment.command.adapterDigest, assignment.command.permission].join('\n')
    const minted = this.tokens?.reusable(key)
    if (minted) {
      await authorizeAssignedCommand(assignment.command, minted.token, { ...this.scope(minted.grantId, signal), jwks: minted.jwks, consume: false })
      assignment.grantId = minted.grantId
      return
    }
    assignment.grantId = await this.acquire(assignment, signal, summary)
    await this.assertActive(assignment.grantId, signal)
    const reply = await this.request(`/api/grants/${encodeURIComponent(assignment.grantId)}/token`, 'POST', signal) as { authz_jwt?: unknown }
    if (!reply || typeof reply.authz_jwt !== 'string') throw new Error('Missing assigned grant token')
    const scope = this.scope(assignment.grantId, signal)
    const jwks = await this.keySet(scope.jwksUri, signal)
    await authorizeAssignedCommand(assignment.command, reply.authz_jwt, { ...scope, jwks })
    const claims = tokenClaims(reply.authz_jwt)
    if (claims.grantType !== 'once') this.tokens?.remember(key, { grantId: assignment.grantId, token: reply.authz_jwt, jwks, expiresAt: claims.exp * 1000 })
  }

  private scope(grantId: string, signal: AbortSignal) {
    const issuer = (this.connection.decisionIssuer ?? this.connection.issuer).replace(/\/$/, '')
    return { issuer, brokered: this.connection.brokered, subject: this.connection.subject, targetHost: this.connection.targetHost, grantId, jwksUri: `${issuer}/.well-known/jwks.json`, grantsEndpoint: `${issuer}/api/grants`, signal, fetch: identityFetch(signal) }
  }

  private async keySet(jwksUri: string, signal: AbortSignal): Promise<VerifyAuthzOptions['jwks']> {
    const response = await identityFetch(signal)(jwksUri, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) })
    if (!response.ok) { await response.body?.cancel(); throw new Error('The identity service did not return its signing keys') }
    return await response.json() as VerifyAuthzOptions['jwks']
  }
}

function identityFetch(signal: AbortSignal) {
  return async (url: string, options: RequestInit): Promise<Response> => {
    let response: Response
    try { response = await fetch(url, options) }
    catch (error) { transientNetwork(error, 'authorization', signal) }
    try { transientResponse(response, 'authorization') }
    catch (error) { await response.body?.cancel(); throw error }
    return response
  }
}
