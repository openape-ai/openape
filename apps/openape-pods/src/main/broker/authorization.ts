import { AuthorityError, transientNetwork, transientResponse } from '../../contracts/infrastructure'
import type { BrokeredGrant, OpenApeAuthZClaims, OpenApeCliAuthorizationDetail } from '@openape/core'
import { cliAuthorizationDetailsCover, computeArgvHash, sameBrokeredGrant, verifyAuthzJWT } from '@openape/grants'
import type { VerifyAuthzOptions } from '@openape/grants'
import type { RunApproval } from '../../contracts/activity'
import { grantSummary } from '../../contracts/grant-summary'
import type { ScriptSummary } from '../../contracts/grant-summary'
import { commandLine } from '../../contracts/programs'
import type { PodPermission } from '../grants/pod-permissions'
import { setTimeout as delay } from 'node:timers/promises'

export type GrantProgress = RunApproval
export type GrantObserver = (progress: GrantProgress) => Promise<void>
export interface Grant { brokered?: BrokeredGrant, id: string, status: string, decided_by?: string, request: { requester: string, audience: string, target_host: string, grant_type: string, duration?: number, waits_until?: number, authorization_details?: { type: string }[], execution_context?: { argv_hash?: string }, summary?: { title?: string } }, created_at?: number }
/**
 * The Pod grant ledger as the authority sees it for the desktop's own permissions (runtime, HTTP, SSH): `find` selects
 * the newest recorded grant whose details cover a permission, `record` keeps every grant this Pod requested or
 * observed, so a pending request is reused instead of asked again. Program calls never look up the ledger: the IdP
 * finds their grants (issue 1473).
 */
export interface GrantLedgerPort {
  find: (detail: OpenApeCliAuthorizationDetail, connection: AgentConnection) => Promise<string | undefined>
  /** An earlier grant of this Pod identity that is not in the ledger yet, read at the IdP with `read` and covering the permission. */
  adopt: (detail: OpenApeCliAuthorizationDetail, connection: AgentConnection, read: (id: string) => Promise<Grant | null>) => Promise<Grant | undefined>
  record: (grant: Grant, connection: AgentConnection) => Promise<void>
}
/** The CLI details a grant authorizes. */
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
/**
 * What the IdP shows about a grant this authority requests (issue 1473): the Pod's name as origin and, for a script
 * call, the script's own summary. It never changes what is requested and is used only when a new grant is requested.
 */
export interface GrantPresentation { origin: string, summary?: ScriptSummary }
/** A desktop-own permission (runtime, HTTP, SSH) and the grant it runs with once found. */
export interface PermissionAuthorization {
  permission: PodPermission
  grantId: string
}
/**
 * One program call as the IdP decides it (issue 1473, revision 4): the program's command name and file hash, and the
 * arguments exactly as executed, without the executable.
 */
export interface ProgramCall { program: { name: string, sha256: string }, argv: string[] }
/** A verified command token: the grant it was issued for and the actions that grant authorizes. */
export interface CommandAuthorization { grantId: string, actions: string[] }
interface MintedGrant { grantId: string, token: string, jwks: VerifyAuthzOptions['jwks'], reusableUntil: number }
interface CommandToken extends CommandAuthorization { reusableUntil: number }
export const grantTokenReuseMs = 60 * 1000
// The IdP issues a command token for at most five minutes (issue 1473, revision 4).
export const commandTokenLifetimeMs = 300 * 1000
const expiryMarginMs = 10 * 1000
// A single-use request is useless once its caller stopped waiting (DDISA grants §3.4).
const onceWaitMs = 15 * 60 * 1000
// The IdP turns a request nobody answered into expired after 48 hours (nuxt-auth-idp grant store).
const pendingRequestTtlMs = 48 * 60 * 60 * 1000

/** Polls quickly while the owner is likely deciding, then slowly so a long wait stays below the IdP rate limit. */
export function decisionPollMs(waitedMs: number): number { return waitedMs < 5 * 60 * 1000 ? 2000 : 30000 }

/**
 * Grant tokens minted during one run. A reusable (non-single-use) permission token is re-verified locally for later
 * calls for at most one minute, and never past shortly before its own expiry. A command token is reused for an
 * identical command (same identity, host, argv hash and program hash) until shortly before it expires.
 */
export class RunGrantTokens {
  private readonly minted = new Map<string, MintedGrant>()
  private readonly commands = new Map<string, CommandToken>()
  private readonly keySets = new Map<string, VerifyAuthzOptions['jwks']>()
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

  command(key: string, now = Date.now()): CommandAuthorization | undefined {
    const entry = this.commands.get(key)
    if (entry && now < entry.reusableUntil) return { grantId: entry.grantId, actions: entry.actions }
    this.commands.delete(key)
    return undefined
  }

  rememberCommand(key: string, authorization: CommandAuthorization, expiresAt: number, now = Date.now()): void {
    this.commands.set(key, { ...authorization, reusableUntil: Math.min(now + commandTokenLifetimeMs, expiresAt) - expiryMarginMs })
  }

  /** The signing keys of an issuer, fetched once per run. */
  async keys(uri: string, load: () => Promise<VerifyAuthzOptions['jwks']>): Promise<VerifyAuthzOptions['jwks']> {
    const cached = this.keySets.get(uri)
    if (cached) return cached
    const loaded = await load()
    this.keySets.set(uri, loaded)
    return loaded
  }

  expired(now = Date.now()): boolean { return this.inflight.size === 0 && [...this.minted.keys()].every(key => !this.reusable(key, now)) && [...this.commands.keys()].every(key => !this.command(key, now)) }
}

/** Awaits a shared operation but leaves as soon as this caller is cancelled. */
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let leave!: () => void
  const left = new Promise<never>((_, reject) => { leave = () => reject(signal.reason); signal.addEventListener('abort', leave, { once: true }) })
  try { return await Promise.race([work, left]) }
  finally { signal.removeEventListener('abort', leave) }
}

function grantTypeOf(claims: OpenApeAuthZClaims): string {
  return claims.grant_type === 'once' || claims.approval === 'once' ? 'once' : String(claims.grant_type)
}

/** The IdP's answer to a program call (issue 1473, revision 4). */
type AuthorizeReply = { state: 'approved', grantId: string, token: string } | { state: 'pending', grantId: string }
interface IdentityReply { status: number, text: string }

const grantIdPattern = /^[\w-]{1,128}$/
const commandRefused = 'The IdP command token does not match this Pod, host, command or program; nothing was run'

export class AgentAuthority {
  private readonly usedOnce = new Set<string>()
  constructor(private readonly connection: AgentConnection, private readonly observe?: GrantObserver, private readonly ledger?: GrantLedgerPort, private readonly tokens?: RunGrantTokens, private readonly presentation?: GrantPresentation) {
    const url = new URL(connection.issuer)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Invalid assigned identity origin')
  }

  /** Reads a bounded identity response; network failures of safe requests and transient statuses become retryable. */
  private async send(path: string, method: 'GET' | 'POST', signal: AbortSignal, body?: unknown): Promise<IdentityReply> {
    const token = await this.connection.accessToken()
    signal.throwIfAborted()
    // Authorizing a program call is safe to repeat: the IdP reuses its pending request or issues another token.
    const safe = method === 'GET' || path.endsWith('/token') || path === '/api/grants/authorize'
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
    return { status: response.status, text: Buffer.concat(chunks).toString('utf8') }
  }

  private refusal(reply: IdentityReply): Error {
    let category = ''
    try { const problem = JSON.parse(reply.text); const type = problem.type ?? problem.data?.type; category = type === 'https://openape.org/errors/grant_not_approved' ? 'grant_not_approved' : '' }
    catch { category = '' }
    if (category === 'grant_not_approved') return new AuthorityError('The grant is no longer approved; review its current status before retrying')
    if (reply.status === 401) return new AuthorityError('OpenApe authentication expired; reconnect the Pod owner in App settings')
    if (reply.status === 403) return new AuthorityError('OpenApe rejected this Pod identity; check its assigned owner and permissions')
    return new Error(`The permission service rejected the request (${reply.status}); inspect the grant before retrying`)
  }

  /** With `missing`, a grant the IdP does not show this identity (403, 404) reads as null instead of failing the call. */
  private async request(path: string, method: 'GET' | 'POST', signal: AbortSignal, body?: unknown, missing = false): Promise<unknown> {
    const reply = await this.send(path, method, signal, body)
    if (reply.status < 200 || reply.status > 299) {
      if (missing && (reply.status === 403 || reply.status === 404)) return null
      throw this.refusal(reply)
    }
    return JSON.parse(reply.text) as unknown
  }

  private async grant(id: string, signal: AbortSignal): Promise<Grant> {
    if (!grantIdPattern.test(id)) throw new Error('Invalid assigned grant')
    const grant = await this.request(`/api/grants/${encodeURIComponent(id)}`, 'GET', signal) as Grant
    if (grant && !sameBrokeredGrant(grant.brokered, this.connection.brokered)) throw new Error('Grant broker binding differs from the assigned identity')
    if (!ownGrant(grant, id, this.connection)) throw new Error('Grant does not belong to this Pod and execution target')
    return grant
  }

  /** A grant id this Pod identity used before; null when the IdP no longer shows it to this identity. */
  private async candidate(id: string, signal: AbortSignal): Promise<Grant | null> {
    if (!grantIdPattern.test(id)) return null
    return await this.request(`/api/grants/${encodeURIComponent(id)}`, 'GET', signal, undefined, true) as Grant | null
  }

  private get decisionIssuer(): string { return (this.connection.decisionIssuer ?? this.connection.issuer).replace(/\/$/, '') }

  /**
   * Authorizes one program call at the IdP (issue 1473, revision 4). The desktop sends the exact command and the
   * program hash; the IdP alone resolves it and finds a grant that covers it. A pending request is shown and awaited
   * like every Pod approval, then the call is authorized again. The returned token is verified before anything runs and
   * reused for an identical command until it expires.
   */
  async authorizeProgram(call: ProgramCall, signal: AbortSignal): Promise<CommandAuthorization> {
    const argvHash = await computeArgvHash([call.program.name, ...call.argv])
    const key = [this.connection.subject, this.connection.targetHost, argvHash, call.program.sha256].join('\n')
    const cached = this.tokens?.command(key)
    if (cached) return cached
    return this.share(`command:${key}`, async () => {
      let reply = await this.authorizeCall(call, signal)
      if (reply.state === 'pending') {
        await this.awaitProgramDecision(reply.grantId, call, signal)
        reply = await this.authorizeCall(call, signal)
        if (reply.state === 'pending') throw new AuthorityError('The approved grant does not cover this command; review it at the IdP')
      }
      const { authorization, expiresAt, once } = await this.verifyCommand(reply, call, argvHash, signal)
      // A single-use grant keeps issuing tokens until it is consumed, so its token runs exactly this call and is never reused.
      if (once) await this.consume(reply.token, reply.grantId, signal)
      else this.tokens?.rememberCommand(key, authorization, expiresAt)
      return authorization
    }, signal)
  }

  /**
   * Asks the IdP once about a program call without waiting or running it, as the owner's grant command does: a pending
   * request is recorded in the ledger so the owner can decide it.
   */
  async requestProgram(call: ProgramCall, signal: AbortSignal): Promise<{ grantId: string, state: 'approved' | 'pending' }> {
    const reply = await this.authorizeCall(call, signal)
    if (reply.state === 'pending') await this.ledger?.record(await this.grant(reply.grantId, signal), this.connection)
    return { grantId: reply.grantId, state: reply.state }
  }

  private async authorizeCall(call: ProgramCall, signal: AbortSignal): Promise<AuthorizeReply> {
    const title = commandLine([call.program.name, ...call.argv])
    const reply = await this.send('/api/grants/authorize', 'POST', signal, { target_host: this.connection.targetHost, audience: 'shapes', program: call.program, argv: call.argv, grant_type: 'always', summary: grantSummary(title, this.presentation?.origin, this.presentation?.summary) })
    let body: Record<string, unknown> | null = null
    try { body = JSON.parse(reply.text) as Record<string, unknown> }
    catch { body = null }
    const grantId = typeof body?.grant_id === 'string' && grantIdPattern.test(body.grant_id) ? body.grant_id : undefined
    if (reply.status === 200 && body?.state === 'approved' && grantId && typeof body.authz_jwt === 'string') return { state: 'approved', grantId, token: body.authz_jwt }
    if (reply.status === 202 && body?.state === 'pending' && grantId) return { state: 'pending', grantId }
    if (reply.status === 403 && grantId && (body?.state === 'denied' || body?.state === 'revoked')) throw new AuthorityError(`Permission ${body.state}; review this Pod's permissions before retrying`)
    if (reply.status === 404 || reply.status === 405) throw new Error('The identity provider does not authorize program calls yet; update it before using this version of OpenApe Pods')
    if (reply.status >= 200 && reply.status <= 299) throw new Error('The permission service returned an invalid authorization')
    throw this.refusal(reply)
  }

  /** Shows the pending request of a program call and waits for the owner's decision; Pods never decides it. */
  private async awaitProgramDecision(grantId: string, call: ProgramCall, signal: AbortSignal): Promise<void> {
    let grant = await this.grant(grantId, signal)
    await this.ledger?.record(grant, this.connection)
    const coverage = grantCoverage(grant)
    const publish = async (state: GrantProgress['state']) => this.observe?.({ grantId, issuer: this.decisionIssuer, title: grant.request.summary?.title ?? coverage[0]?.display ?? commandLine([call.program.name, ...call.argv]), ...(coverage[0] ? { permission: coverage[0].permission } : {}), subject: this.connection.subject, state })
    if (grant.status === 'pending') {
      grant = await this.decision(grant, publish, signal)
      await this.ledger?.record(grant, this.connection)
    }
    if (grant.status !== 'approved') throw new AuthorityError(grant.status === 'pending' ? 'Permission was not decided while this command waited; start it again and approve at the IdP' : grant.status === 'expired' ? 'Permission request expired at the IdP; start a new run to request it again' : `Permission ${grant.status}; review this Pod's permissions before retrying`)
    await publish('approved')
  }

  /**
   * Verifies a command token before anything runs: the decision IdP's signature and issuer, this Pod identity and
   * execution target, the grant it answers, the hash of exactly the argv about to run and the program's file hash. A
   * broker binding in the token must be this connection's.
   */
  private async verifyCommand(reply: Extract<AuthorizeReply, { state: 'approved' }>, call: ProgramCall, argvHash: string, signal: AbortSignal): Promise<{ authorization: CommandAuthorization, expiresAt: number, once: boolean }> {
    const issuer = this.decisionIssuer
    const result = await verifyAuthzJWT(reply.token, { expectedIss: issuer, expectedAud: 'shapes', jwks: await this.keySet(signal) })
    if (!result.valid || !result.claims) throw new AuthorityError(commandRefused)
    const claims = result.claims as OpenApeAuthZClaims & { argv_hash?: unknown, program_sha256?: unknown }
    if (claims.sub !== this.connection.subject || claims.target_host !== this.connection.targetHost || claims.grant_id !== reply.grantId || claims.argv_hash !== argvHash || claims.program_sha256 !== call.program.sha256) throw new AuthorityError(commandRefused)
    if (claims.brokered && !sameBrokeredGrant(this.connection.brokered, claims.brokered)) throw new AuthorityError(commandRefused)
    const actions = (claims.authorization_details ?? []).flatMap(detail => detail.type === 'openape_cli' ? [detail.action] : [])
    return { authorization: { grantId: reply.grantId, actions }, expiresAt: claims.exp * 1000, once: grantTypeOf(claims) === 'once' }
  }

  /** Finds or requests the grant of a desktop-own permission and waits for its decision; returns its id. */
  async acquire(assignment: PermissionAuthorization, signal: AbortSignal): Promise<string> {
    const detail = assignment.permission.detail
    let grant = assignment.grantId ? await this.grant(assignment.grantId, signal) : undefined
    if (grant && !covers(grant, detail)) throw new AuthorityError('The assigned grant does not cover this permission')
    if (!grant || ['used', 'expired'].includes(grant.status)) {
      const recorded = await this.ledger?.find(detail, this.connection)
      if (recorded && recorded !== grant?.id) {
        const candidate = await this.grant(recorded, signal)
        if (covers(candidate, detail)) grant = candidate
      }
    }
    // A grant this identity received before the ledger recorded it (schema 43 moved them out of the resources) is
    // adopted instead of asking the owner again; the IdP does not return it for a new brokered request.
    if (!grant || ['used', 'expired'].includes(grant.status)) {
      const adopted = await this.ledger?.adopt(detail, this.connection, id => this.candidate(id, signal))
      if (adopted && covers(adopted, detail)) grant = adopted
    }
    // A pending request is reused, so an interrupted wait never asks again; a single-use request whose caller
    // stopped waiting can no longer run anything (DDISA grants §3.4) and is replaced.
    if (grant?.status === 'pending' && grant.request.grant_type === 'once' && (grant.request.waits_until ?? 0) * 1000 <= Date.now()) grant = undefined
    if (grant) await this.ledger?.record(grant, this.connection)
    if (grant && ['denied', 'revoked'].includes(grant.status)) throw new AuthorityError(`Permission ${grant.status}; review this Pod's permissions before retrying`)
    if (!grant || grant.status === 'used' || grant.status === 'expired') {
      // Every Pod grant is a continuing grant (owner decision October 10, 2026); per-item approvals are gate batches.
      const create = async () => await this.request('/api/grants', 'POST', signal, { requester: this.connection.subject, target_host: this.connection.targetHost, audience: 'shapes', grant_type: 'always', command: assignment.permission.argv, permissions: [detail.permission], authorization_details: [detail], reason: detail.display, summary: grantSummary(detail.display, this.presentation?.origin, this.presentation?.summary) }) as { id?: unknown }
      // Parallel calls of one run ask once.
      const created = await this.share(`request:${detail.permission}`, create, signal)
      if (typeof created?.id !== 'string') throw new Error('Permission service returned an invalid grant')
      grant = await this.grant(created.id, signal)
      await this.ledger?.record(grant, this.connection)
    }
    const current = grant
    const publish = async (state: GrantProgress['state']) => this.observe?.({ grantId: current.id, issuer: this.decisionIssuer, title: detail.display, permission: detail.permission, subject: this.connection.subject, state })
    if (grant.status === 'pending') {
      grant = await this.decision(grant, publish, signal)
      await this.ledger?.record(grant, this.connection)
    }
    if (grant.status !== 'approved') throw new AuthorityError(grant.status === 'pending' ? 'Permission was not decided while this command waited; start it again and approve at the IdP' : grant.status === 'expired' ? 'Permission request expired at the IdP; start a new run to request it again' : `Permission ${grant.status}; review this Pod's permissions before retrying`)
    if (!covers(grant, detail)) throw new AuthorityError('The approved grant no longer covers this permission; request it again')
    await publish('approved')
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
    if (!grantIdPattern.test(grantId)) throw new Error('Invalid assigned grant')
    const state = await this.request(`/api/pods/agents/${encodeURIComponent(this.connection.subject)}?grant=${encodeURIComponent(grantId)}`, 'GET', signal) as Record<string, unknown>
    if (!state || state.email !== this.connection.subject || state.owner !== this.connection.owner || state.active !== true || state.grantActive !== true || state.grantId !== grantId || !Array.isArray(state.keyIds) || !state.keyIds.includes(this.connection.keyId)) throw new AuthorityError('Pod identity, key or grant is no longer active')
  }

  /** Authorizes a desktop-own permission (runtime, HTTP, SSH) with a grant found in the ledger or requested now. */
  async authorize(assignment: PermissionAuthorization, signal: AbortSignal): Promise<void> {
    if (!assignment.grantId && this.ledger) assignment.grantId = await this.ledger.find(assignment.permission.detail, this.connection) ?? ''
    if (await this.reuse(assignment, signal)) return
    assignment.grantId = await this.acquire(assignment, signal)
    await this.mint(assignment, signal)
  }

  /**
   * Re-checks an already acquired grant during a run. It never looks up a previous grant, never creates
   * one and never approves one: a grant that is no longer approved ends the run's authority.
   */
  async refresh(assignment: PermissionAuthorization, signal: AbortSignal): Promise<void> {
    if (await this.reuse(assignment, signal)) return
    // A once grant this run used up stays its authority; the IdP reports it active until it is revoked or expires.
    if (this.usedOnce.has(assignment.grantId)) return this.assertActive(assignment.grantId, signal)
    const grant = await this.grant(assignment.grantId, signal)
    if (grant.status !== 'approved') throw new AuthorityError(`Pod execution permission is ${grant.status}; review the Pod permissions before retrying`)
    await this.mint(assignment, signal)
  }

  // The key includes the grant, so a token is only reused for the very grant it was minted for.
  private tokenKey(assignment: PermissionAuthorization): string {
    return [this.connection.subject, this.connection.targetHost, this.connection.keyId, assignment.grantId, assignment.permission.detail.permission].join('\n')
  }

  private async reuse(assignment: PermissionAuthorization, signal: AbortSignal): Promise<boolean> {
    if (!assignment.grantId) return false
    const minted = this.tokens?.reusable(this.tokenKey(assignment))
    if (!minted || minted.grantId !== assignment.grantId) return false
    const claims = await this.verifyPermission(minted.token, assignment, minted.jwks)
    if (grantTypeOf(claims) === 'once') throw new Error('A single-use grant must be consumed')
    signal.throwIfAborted()
    return true
  }

  private async mint(assignment: PermissionAuthorization, signal: AbortSignal): Promise<void> {
    await this.assertActive(assignment.grantId, signal)
    const reply = await this.request(`/api/grants/${encodeURIComponent(assignment.grantId)}/token`, 'POST', signal) as { authz_jwt?: unknown }
    if (!reply || typeof reply.authz_jwt !== 'string') throw new Error('Missing assigned grant token')
    const jwks = await this.keySet(signal)
    const claims = await this.verifyPermission(reply.authz_jwt, assignment, jwks)
    await this.consume(reply.authz_jwt, assignment.grantId, signal)
    if (grantTypeOf(claims) === 'once') this.usedOnce.add(assignment.grantId)
    else this.tokens?.remember(this.tokenKey(assignment), { grantId: assignment.grantId, token: reply.authz_jwt, jwks, expiresAt: claims.exp * 1000 })
  }

  /**
   * Verifies a permission token: the decision IdP's signature and issuer, this identity, target and broker binding (a
   * brokered grant decided by its owner), the grant it was minted for, and details that cover the permission.
   */
  private async verifyPermission(token: string, assignment: PermissionAuthorization, jwks: VerifyAuthzOptions['jwks']): Promise<OpenApeAuthZClaims> {
    const result = await verifyAuthzJWT(token, { expectedIss: this.decisionIssuer, expectedAud: 'shapes', jwks })
    if (!result.valid || !result.claims) throw new Error(result.error ?? 'Grant verification failed')
    const claims = result.claims
    const brokered = this.connection.brokered
    if (!sameBrokeredGrant(brokered, claims.brokered) || (brokered && claims.decided_by !== brokered.owner)) throw new Error('Grant does not match the assigned broker connection')
    if (claims.sub !== this.connection.subject || claims.target_host !== this.connection.targetHost || claims.grant_id !== assignment.grantId || claims.run_as !== undefined) throw new Error('Grant does not match the assigned identity or host')
    const details = (claims.authorization_details ?? []).filter((detail): detail is OpenApeCliAuthorizationDetail => detail.type === 'openape_cli')
    if (!details.length || !cliAuthorizationDetailsCover(details, [assignment.permission.detail])) throw new Error(`Grant does not cover required permission: ${assignment.permission.detail.permission}`)
    return claims
  }

  /** Marks a freshly minted token as used at the IdP; a single-use grant ends here. */
  private async consume(token: string, grantId: string, signal: AbortSignal): Promise<void> {
    const response = await identityFetch(signal)(`${this.decisionIssuer}/api/grants/${encodeURIComponent(grantId)}/consume`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Consume failed: ${response.status}`) }
    const result = await response.json() as { error?: string, status?: string }
    if (result.error) throw new Error(`Grant rejected at consume step: ${result.error}`)
    if (!['valid', 'consumed'].includes(result.status ?? '')) throw new Error('Unrecognized grant consume response')
  }

  private async keySet(signal: AbortSignal): Promise<VerifyAuthzOptions['jwks']> {
    const uri = `${this.decisionIssuer}/.well-known/jwks.json`
    const load = async () => {
      const response = await identityFetch(signal)(uri, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) })
      if (!response.ok) { await response.body?.cancel(); throw new Error('The identity service did not return its signing keys') }
      return await response.json() as VerifyAuthzOptions['jwks']
    }
    return this.tokens ? this.tokens.keys(uri, load) : load()
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
