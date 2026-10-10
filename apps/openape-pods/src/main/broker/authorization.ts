import { AuthorityError, transientNetwork, transientResponse  } from '../../contracts/infrastructure'
import type { BrokeredGrant, OpenApeCliAuthorizationDetail } from '@openape/core'
import { cliAuthorizationDetailsCover, sameBrokeredGrant } from '@openape/grants'
import type { VerifyAuthzOptions } from '@openape/grants'
import { authorizeAssignedCommand } from '@openape/apes/assigned'
import type { AssignedCommand } from '@openape/apes/assigned'
import type { RunApproval } from '../../contracts/activity'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { setTimeout as delay } from 'node:timers/promises'

export type GrantProgress = RunApproval
export type GrantObserver = (progress: GrantProgress) => Promise<void>
export interface Grant { brokered?: BrokeredGrant, id: string, status: string, decided_by?: string, request: { requester: string, audience: string, target_host: string, grant_type: string, duration?: number, waits_until?: number, authorization_details?: { type: string }[] }, created_at?: number }
/**
 * The Pod grant ledger as the authority sees it: `find` selects the newest recorded grant whose details cover a call,
 * `record` keeps every grant this Pod requested or observed, so a pending request is reused instead of asked again.
 */
export interface GrantLedgerPort {
  find: (detail: OpenApeCliAuthorizationDetail, connection: AgentConnection) => Promise<string | undefined>
  /** An earlier grant of this Pod identity that is not in the ledger yet, read at the IdP with `read` and covering the call. */
  adopt: (detail: OpenApeCliAuthorizationDetail, connection: AgentConnection, read: (id: string) => Promise<Grant | null>) => Promise<Grant | undefined>
  record: (grant: Grant, connection: AgentConnection) => Promise<void>
}
/** The CLI details a grant authorizes; a call is covered when one of them covers its resolved detail. */
export function grantCoverage(grant: Pick<Grant, 'request'>): OpenApeCliAuthorizationDetail[] {
  return (grant.request.authorization_details ?? []).filter((detail): detail is OpenApeCliAuthorizationDetail => detail?.type === 'openape_cli')
}
/** A grant this Pod identity requested for its execution target, through the same broker connection. */
export function ownGrant(grant: Grant, id: string, connection: AgentConnection): boolean {
  return grant?.id === id && ['pending', 'approved', 'used', 'expired', 'denied', 'revoked'].includes(grant.status) && grant.request?.requester === connection.subject && grant.request.audience === 'shapes' && grant.request.target_host === connection.targetHost && sameBrokeredGrant(grant.brokered, connection.brokered)
}
function covers(grant: Grant, detail: OpenApeCliAuthorizationDetail): boolean {
  const coverage = grantCoverage(grant)
  return coverage.length > 0 && cliAuthorizationDetailsCover(coverage, [detail])
}

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
// A single-use request is useless once its caller stopped waiting (DDISA grants §3.4).
const onceWaitMs = 15 * 60 * 1000
// The IdP turns a request nobody answered into expired after 48 hours (nuxt-auth-idp grant store).
const pendingRequestTtlMs = 48 * 60 * 60 * 1000

/** Polls quickly while the owner is likely deciding, then slowly so a long wait stays below the IdP rate limit. */
export function decisionPollMs(waitedMs: number): number { return waitedMs < 5 * 60 * 1000 ? 2000 : 30000 }

/**
 * Grant tokens minted during one run. A reusable (non-single-use) token is
 * re-verified locally for later calls for at most one minute, and never past
 * shortly before its own expiry, so a run contacts the identity provider at
 * most once per grant and minute instead of once per call.
 */
export class RunGrantTokens {
  private readonly minted = new Map<string, MintedGrant>()
  private readonly inflight = new Map<string, Promise<unknown>>()
  /** One in-flight grant request or decision wait per key and run; concurrent calls share its result. */
  shared<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const promise = work().finally(() => this.inflight.delete(key))
    this.inflight.set(key, promise)
    return promise
  }

  reusable(key: string, now = Date.now()): MintedGrant | undefined {
    const entry = this.minted.get(key)
    if (entry && now < entry.reusableUntil) return entry
    this.minted.delete(key)
    return undefined
  }

  remember(key: string, grant: { grantId: string, token: string, jwks: VerifyAuthzOptions['jwks'], expiresAt: number }, now = Date.now()): void {
    this.minted.set(key, { grantId: grant.grantId, token: grant.token, jwks: grant.jwks, reusableUntil: Math.min(now + grantTokenReuseMs, grant.expiresAt - expiryMarginMs) })
  }

  expired(now = Date.now()): boolean { return this.inflight.size === 0 && [...this.minted.keys()].every(key => !this.reusable(key, now)) }
}

/** Awaits a shared operation but leaves as soon as this caller is cancelled. */
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let leave!: () => void
  const left = new Promise<never>((_, reject) => { leave = () => reject(signal.reason); signal.addEventListener('abort', leave, { once: true }) })
  try { return await Promise.race([work, left]) }
  finally { signal.removeEventListener('abort', leave) }
}

function tokenClaims(token: string): { exp: number, grantType: string } {
  const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: unknown, grant_type?: unknown, approval?: unknown }
  if (typeof claims.exp !== 'number') throw new Error('Grant token has no expiry')
  return { exp: claims.exp, grantType: claims.grant_type === 'once' || claims.approval === 'once' ? 'once' : String(claims.grant_type) }
}

export class AgentAuthority {
  constructor(private readonly connection: AgentConnection, private readonly observe?: GrantObserver, private readonly ledger?: GrantLedgerPort, private readonly tokens?: RunGrantTokens) {
    const url = new URL(connection.issuer)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Invalid assigned identity origin')
  }

  /** With `missing`, a grant the IdP does not show this identity (403, 404) reads as null instead of failing the call. */
  private async request(path: string, method: 'GET' | 'POST', signal: AbortSignal, body?: unknown, missing = false): Promise<unknown> {
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
      if (missing && (response.status === 403 || response.status === 404)) return null
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
    if (grant && !sameBrokeredGrant(grant.brokered, this.connection.brokered)) throw new Error('Grant broker binding differs from the assigned identity')
    if (!ownGrant(grant, id, this.connection)) throw new Error('Grant does not belong to this Pod and execution target')
    return grant
  }

  /** A grant id this Pod identity used before; null when the IdP no longer shows it to this identity. */
  private async candidate(id: string, signal: AbortSignal): Promise<Grant | null> {
    if (!/^[\w-]{1,128}$/.test(id)) return null
    return await this.request(`/api/grants/${encodeURIComponent(id)}`, 'GET', signal, undefined, true) as Grant | null
  }

  /** Resolves the command with its pinned adapter; it must lie inside the requested coverage and never be a generic execution. */
  private async resolve(assignment: AssignedAuthorization) {
    const adapter = loadAdapter(assignment.command.cliId, assignment.command.adapterPath)
    if (adapter.digest !== assignment.command.adapterDigest) throw new Error('Assigned adapter integrity mismatch')
    const resolved = await resolveCommand(adapter, assignment.command.argv)
    if (resolved.detail.operation_id === '_generic.exec' || !cliAuthorizationDetailsCover(assignment.command.coverage, [resolved.detail])) throw new Error('Command is outside the assigned operation')
    return resolved
  }

  async acquire(assignment: AssignedAuthorization, signal: AbortSignal, summary?: string): Promise<string> {
    const resolved = await this.resolve(assignment)
    let grant = assignment.grantId ? await this.grant(assignment.grantId, signal) : undefined
    if (grant && !covers(grant, resolved.detail)) throw new AuthorityError('The assigned grant does not cover this command')
    if (!grant || ['used', 'expired'].includes(grant.status)) {
      const recorded = await this.ledger?.find(resolved.detail, this.connection)
      if (recorded && recorded !== grant?.id) {
        const candidate = await this.grant(recorded, signal)
        if (covers(candidate, resolved.detail)) grant = candidate
      }
    }
    // A grant this identity received before the ledger recorded it (schema 43 moved them out of the resources) is
    // adopted instead of asking the owner again; the IdP does not return it for a new brokered request.
    if (!grant || ['used', 'expired'].includes(grant.status)) grant = await this.ledger?.adopt(resolved.detail, this.connection, id => this.candidate(id, signal)) ?? grant
    // A pending request is reused, so an interrupted wait never asks again; a single-use request whose caller
    // stopped waiting can no longer run anything (DDISA grants §3.4) and is replaced.
    if (grant?.status === 'pending' && grant.request.grant_type === 'once' && (grant.request.waits_until ?? 0) * 1000 <= Date.now()) grant = undefined
    if (grant) await this.ledger?.record(grant, this.connection)
    if (grant && ['denied', 'revoked'].includes(grant.status)) throw new AuthorityError(`Permission ${grant.status}; review this Pod's permissions before retrying`)
    if (!grant || grant.status === 'used' || grant.status === 'expired') {
      // Every Pod grant is a continuing grant (owner decision October 10, 2026); per-item approvals are gate batches.
      const create = async () => await this.request('/api/grants', 'POST', signal, { requester: this.connection.subject, target_host: this.connection.targetHost, audience: 'shapes', grant_type: 'always', command: assignment.command.argv, permissions: [resolved.permission], authorization_details: [resolved.detail], execution_context: resolved.executionContext, reason: resolved.detail.display, ...(summary ? { summary: { text: summary } } : {}) }) as { id?: unknown }
      // Parallel calls of one run ask once.
      const created = await this.share(`request:${resolved.permission}`, create, signal)
      if (typeof created?.id !== 'string') throw new Error('Permission service returned an invalid grant')
      grant = await this.grant(created.id, signal)
      await this.ledger?.record(grant, this.connection)
    }
    const current = grant
    const publish = async (state: GrantProgress['state']) => this.observe?.({ grantId: current.id, issuer: this.connection.decisionIssuer ?? this.connection.issuer, title: resolved.detail.display, permission: resolved.permission, subject: this.connection.subject, state })
    if (grant.status === 'pending') {
      grant = await this.decision(grant, publish, signal)
      await this.ledger?.record(grant, this.connection)
    }
    if (grant.status !== 'approved') throw new AuthorityError(grant.status === 'pending' ? 'Permission was not decided while this command waited; start it again and approve at the IdP' : grant.status === 'expired' ? 'Permission request expired at the IdP; start a new run to request it again' : `Permission ${grant.status}; review this Pod's permissions before retrying`)
    if (!covers(grant, resolved.detail)) throw new AuthorityError('The approved grant no longer covers this command; request it again')
    await publish('approved')
    assignment.command.coverage = grantCoverage(grant)
    return grant.id
  }

  /**
   * Waits for the owner's decision; the run never decides itself. The run shows the pending approval (desktop,
   * inbox and MCP open the IdP page; an MCP owner session may approve it). A continuing grant is awaited until the owner decides or the
   * IdP expires the request; a single-use request only while its caller waits.
   */
  private async decision(pending: Grant, publish: (state: GrantProgress['state']) => Promise<void>, signal: AbortSignal): Promise<Grant> {
    if (!this.observe) throw new Error('Permission needs owner approval at the IdP; open this Pod in OpenApe Pods')
    await publish('pending')
    let grant: Grant
    // Calls of the same run that need this grant share one wait instead of polling the IdP separately.
    try { grant = await this.share(`decision:${pending.id}`, () => this.poll(pending, signal), signal) }
    catch (error) { await publish('cancelled'); throw error }
    if (grant.status !== 'approved') await publish(grant.status === 'denied' ? 'denied' : grant.status === 'revoked' ? 'revoked' : 'expired')
    return grant
  }

  /** Polls until the owner decides; a continuing request at most until the IdP expires it, a single-use one while its caller waits. */
  private async poll(pending: Grant, signal: AbortSignal): Promise<Grant> {
    const started = Date.now()
    const deadline = pending.request.grant_type === 'always' ? (typeof pending.created_at === 'number' ? pending.created_at * 1000 : started) + pendingRequestTtlMs : started + onceWaitMs
    let grant = pending
    while (grant.status === 'pending' && Date.now() < deadline) {
      await delay(decisionPollMs(Date.now() - started), undefined, { signal })
      grant = await this.grant(grant.id, signal)
    }
    return grant
  }

  private share<T>(key: string, work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return this.tokens ? abortable(this.tokens.shared(`${this.connection.subject}\n${key}`, work), signal) : work()
  }

  async assertActive(grantId: string, signal: AbortSignal): Promise<void> {
    if (!/^[\w-]{1,128}$/.test(grantId)) throw new Error('Invalid assigned grant')
    const state = await this.request(`/api/pods/agents/${encodeURIComponent(this.connection.subject)}?grant=${encodeURIComponent(grantId)}`, 'GET', signal) as Record<string, unknown>
    if (!state || state.email !== this.connection.subject || state.owner !== this.connection.owner || state.active !== true || state.grantActive !== true || state.grantId !== grantId || !Array.isArray(state.keyIds) || !state.keyIds.includes(this.connection.keyId)) throw new AuthorityError('Pod identity, key or grant is no longer active')
  }

  async authorize(assignment: AssignedAuthorization, signal: AbortSignal, summary?: string): Promise<void> {
    if (!assignment.grantId && this.ledger) assignment.grantId = await this.ledger.find((await this.resolve(assignment)).detail, this.connection) ?? ''
    if (await this.reuse(assignment, signal)) return
    assignment.grantId = await this.acquire(assignment, signal, summary)
    await this.mint(assignment, signal)
  }

  /**
   * Re-checks an already acquired grant during a run. It never looks up a previous grant, never creates
   * one and never approves one: a grant that is no longer approved ends the run's authority.
   */
  async refresh(assignment: AssignedAuthorization, signal: AbortSignal): Promise<void> {
    if (await this.reuse(assignment, signal)) return
    const grant = await this.grant(assignment.grantId, signal)
    if (grant.status !== 'approved') throw new AuthorityError(`Pod execution permission is ${grant.status}; review the Pod permissions before retrying`)
    await this.mint(assignment, signal)
  }

  // The key includes the grant, so a token is only reused for the very grant it was minted for.
  private tokenKey(assignment: AssignedAuthorization): string {
    return [this.connection.subject, this.connection.targetHost, this.connection.keyId, assignment.grantId, assignment.command.cliId, assignment.command.adapterDigest].join('\n')
  }

  private async reuse(assignment: AssignedAuthorization, signal: AbortSignal): Promise<boolean> {
    if (!assignment.grantId) return false
    const minted = this.tokens?.reusable(this.tokenKey(assignment))
    if (!minted || minted.grantId !== assignment.grantId) return false
    await authorizeAssignedCommand(assignment.command, minted.token, { ...this.scope(minted.grantId, signal), jwks: minted.jwks, consume: false })
    return true
  }

  private async mint(assignment: AssignedAuthorization, signal: AbortSignal): Promise<void> {
    await this.assertActive(assignment.grantId, signal)
    const reply = await this.request(`/api/grants/${encodeURIComponent(assignment.grantId)}/token`, 'POST', signal) as { authz_jwt?: unknown }
    if (!reply || typeof reply.authz_jwt !== 'string') throw new Error('Missing assigned grant token')
    const scope = this.scope(assignment.grantId, signal)
    const jwks = await this.keySet(scope.jwksUri, signal)
    await authorizeAssignedCommand(assignment.command, reply.authz_jwt, { ...scope, jwks })
    const claims = tokenClaims(reply.authz_jwt)
    if (claims.grantType !== 'once') this.tokens?.remember(this.tokenKey(assignment), { grantId: assignment.grantId, token: reply.authz_jwt, jwks, expiresAt: claims.exp * 1000 })
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
