import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { cliAuthorizationDetailsCover, sameBrokeredGrant } from '@openape/grants'
import { approvalURL } from '../../contracts/activity'
import { approvalAudience } from '../../contracts/approvals'
import { grantSummary } from '../../contracts/grant-summary'
import type { ScriptSummary } from '../../contracts/grant-summary'
import { parsePodGrant, grantTypes  } from '../../contracts/grants'
import type { GrantState, GrantType, PodGrant } from '../../contracts/grants'
import { AgentAuthority, grantCoverage, ownGrant } from '../broker/authorization'
import type { AgentConnection, Grant, GrantLedgerPort, ProgramCall } from '../broker/authorization'
import { connectionRequest, readJSON } from '../connections/http'
import type { OwnerSession } from '../connections/owner-session'
import type { GrantLedgerCommand } from '../../worker/resources/grants'
import { httpPermission, originPermission, runtimePermission, sshPermission } from './pod-permissions'

/**
 * What one request for a desktop-own permission asks for, as the Pod identity: its fixed authorization details and the
 * command the IdP shows it with. Program commands are never requested this way; the IdP authorizes them per call.
 */
export interface GrantSpec { details: OpenApeCliAuthorizationDetail[], command: string[], display: string }
export interface PodConnection extends AgentConnection { owner: string }
export interface GrantResult { grant: PodGrant, approval: string | null }
/**
 * A decision made in the owner session; `grant` is the ledger entry when the grant is a Pod grant, not an object approval
 * item. `requestedType` is what the Pod asked for; `widened` records that the owner explicitly chose a wider type.
 */
export interface GrantDecision { id: string, podId: string, state: GrantState, grantType: GrantType, requestedType: GrantType, widened: boolean, approvedInSession: boolean, grant: PodGrant | null }

const grantIdPattern = /^[\w-]{1,128}$/
const endedStates = ['revoked', 'denied', 'expired', 'used']

/** The grant to run the Pod's stored script; it covers every run of this Pod whatever its script, workspace or name. */
export function runtimeSpec(podId: string, name: string): GrantSpec {
  const { detail, argv } = runtimePermission({ podId, name, script: 'run.mjs', workspace: 'workspace' })
  return { details: [detail], command: argv, display: detail.display }
}

/** An HTTPS origin; with methods, one detail per method, otherwise every method of that origin. */
export function httpSpec(origin: string, methods?: string[]): GrantSpec {
  if (!methods) {
    const { detail, argv } = originPermission(origin)
    return { details: [detail], command: argv, display: detail.display }
  }
  const permissions = methods.map(method => httpPermission(origin, method))
  const details = permissions.map(item => item.detail)
  return { details, command: permissions.length === 1 ? permissions[0]!.argv : ['pod-http'], display: details.map(detail => detail.display).join('; ') }
}

/** The fixed inventory of one reviewed SSH binding; `argv` is sshGrantArgv of that binding. */
export function sshSpec(argv: string[]): GrantSpec {
  const { detail } = sshPermission(argv)
  return { details: [detail], command: argv, display: detail.display }
}

function typeOf(value: string): GrantType {
  if (!grantTypes.includes(value as GrantType)) throw new Error(`Unexpected grant type ${value}`)
  return value as GrantType
}

function stateOf(status: string): GrantState {
  if (!['pending', 'approved', 'denied', 'revoked', 'expired', 'used'].includes(status)) throw new Error(`Unexpected grant status ${status}`)
  return status as GrantState
}

/**
 * The Pod grants: requested by the Pod identity, recorded in the ledger, and decided by the owner.
 * `approve` and `deny` are the only Pods code that decides a grant. They need the owner session of an MCP call, use
 * its token and check before deciding that the grant was requested by this owner's Pod identity for this Pod.
 */
export class PodGrants {
  // Earlier grant ids already read at the IdP that this process did not adopt; they are not read again.
  private readonly checked = new Set<string>()
  // Pending grants whose refresh failed are reported once; they are read again on every refresh.
  private readonly unreadable = new Set<string>()
  constructor(private readonly dependencies: { connection: (podId: string) => Promise<PodConnection>, ledger: (command: GrantLedgerCommand) => Promise<unknown>, podName: (podId: string) => Promise<string> }) {}

  /** The ledger as one Pod's authority uses it. */
  port(podId: string): GrantLedgerPort {
    return {
      find: async (detail, connection) => (await this.dependencies.ledger({ type: 'find', podId, issuer: connection.decisionIssuer ?? connection.issuer, subject: connection.subject, detail }) as string | null) ?? undefined,
      adopt: async (detail, connection, read) => await this.adopt(podId, connection, [detail], read) ?? undefined,
      record: async (grant, connection) => { if (grant.request.audience === 'shapes' && grantCoverage(grant).length) await this.record(podId, connection, grant) },
    }
  }

  async list(filter: { podId?: string }): Promise<PodGrant[]> {
    return await this.dependencies.ledger({ type: 'list', ...filter }) as PodGrant[]
  }

  /** The IdP page of a pending grant this Pod requested, checked against the Pod's own identity before it opens. */
  async approvalPage(podId: string, grantId: string): Promise<string> {
    const grant = (await this.list({ podId })).find(item => item.id === grantId && item.state === 'pending')
    if (!grant) throw new Error('This grant no longer waits for your decision; refresh the view')
    const connection = await this.dependencies.connection(podId)
    if (grant.issuer !== (connection.decisionIssuer ?? connection.issuer) || grant.subject !== connection.subject) throw new Error('Approval belongs to a different Pod identity')
    return this.result(grant).approval!
  }

  /**
   * Reads the pending ledger grants at the IdP again, so a grant the owner decided on the IdP page, or that the IdP
   * expired, leaves the owner's open decisions. At most `limit` grants are read per call.
   */
  async refreshPending(signal: AbortSignal, limit = 16): Promise<void> {
    for (const grant of (await this.list({})).filter(item => item.state === 'pending').slice(0, limit)) {
      try {
        const connection = await this.dependencies.connection(grant.podId)
        await this.record(grant.podId, connection, await this.read(connection, grant.id, signal), grant.approvedInSession)
        this.unreadable.delete(grant.id)
      }
      catch (error) {
        if (this.unreadable.has(grant.id)) continue
        this.unreadable.add(grant.id)
        console.error(`Could not refresh the pending Pod grant ${grant.id}`, error)
      }
    }
  }

  /**
   * Asks the IdP once about one program command as the Pod, without running it (issue 1473, revision 4): an approved
   * grant that covers it needs nothing; otherwise the IdP's pending request is recorded and its approval page returned.
   */
  async requestProgram(podId: string, call: ProgramCall, signal: AbortSignal, summary?: ScriptSummary): Promise<{ grantId: string, approval: string | null }> {
    const connection = await this.dependencies.connection(podId)
    const authority = new AgentAuthority(connection, undefined, this.port(podId), undefined, { origin: await this.dependencies.podName(podId), ...(summary ? { summary } : {}) })
    const reply = await authority.requestProgram(call, signal)
    if (reply.state === 'approved') return { grantId: reply.grantId, approval: null }
    const recorded = (await this.list({ podId })).find(grant => grant.id === reply.grantId)
    return { grantId: reply.grantId, approval: approvalURL({ grantId: reply.grantId, issuer: connection.decisionIssuer ?? connection.issuer, state: 'pending', title: recorded?.display ?? 'Program command' }) }
  }

  /** Requests one continuing grant for a desktop-own permission as the Pod; an equal pending or approved request is reused, so retries never ask twice. */
  async request(podId: string, spec: GrantSpec, signal: AbortSignal): Promise<GrantResult> {
    const connection = await this.dependencies.connection(podId)
    const issuer = connection.decisionIssuer ?? connection.issuer
    const existing = await this.dependencies.ledger({ type: 'same', podId, issuer, subject: connection.subject, details: spec.details }) as PodGrant | null
    if (existing) {
      const current = await this.record(podId, connection, await this.read(connection, existing.id, signal))
      if (['pending', 'approved'].includes(current.state)) return this.result(current)
    }
    const adopted = await this.adopt(podId, connection, spec.details, id => this.candidate(connection, id, signal))
    if (adopted) return this.result(await this.record(podId, connection, adopted))
    const response = await fetch(`${connection.issuer}/api/grants`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await connection.accessToken()}` }, body: JSON.stringify({ requester: connection.subject, target_host: connection.targetHost, audience: 'shapes', grant_type: 'always', command: spec.command, permissions: spec.details.map(detail => detail.permission), authorization_details: spec.details, reason: spec.display.slice(0, 4096), summary: grantSummary(spec.display, await this.dependencies.podName(podId)) }) })
    // 201 is a new request; 200 is an existing approved grant the IdP reused.
    const created = await readJSON(response)
    if (typeof created.id !== 'string' || !grantIdPattern.test(created.id)) throw new Error('Invalid grant response; inspect the Pod grants before retrying')
    return this.result(await this.record(podId, connection, await this.read(connection, created.id, signal)))
  }

  /**
   * Approves as the signed-in owner, as the type the Pod requested (a timed grant with its requested duration). Only an
   * explicit `grantType` of the owner session approves a different type, like the owner choosing it on the IdP page;
   * the decision reports it as widened. Without an active owner session this throws before any IdP call.
   */
  async approve(owner: OwnerSession | null, podId: string, grantId: string, grantType: GrantType | undefined, signal: AbortSignal): Promise<GrantDecision> {
    const { connection, issuer, bearer, grant } = await this.decidable(owner, podId, grantId, signal)
    if (grant.request.audience !== 'shapes') throw new Error('Historical execution grants cannot be approved; migrate the recipe and request the exact call through ape-shell')
    const requested = typeOf(grant.request.grant_type)
    if (grant.status === 'approved') return this.decided(podId, connection, grant, false, requested)
    if (grant.status !== 'pending') throw new Error(`This grant is ${grant.status}; request it again instead`)
    const type = grantType ?? requested
    if (type === 'timed' && (requested !== 'timed' || typeof grant.request.duration !== 'number')) throw new Error('A timed approval needs the duration the Pod requested')
    const reply = await connectionRequest(issuer, `/api/grants/${encodeURIComponent(grantId)}/approve`, { grant_type: type, ...(type === 'timed' ? { duration: grant.request.duration } : {}) }, signal, bearer)
    const approved = reply.grant as Grant | undefined
    if (approved?.id !== grantId || approved.status !== 'approved') throw new Error('The identity provider did not approve this grant')
    return this.decided(podId, connection, approved, true, requested)
  }

  async deny(owner: OwnerSession | null, podId: string, grantId: string, signal: AbortSignal): Promise<GrantDecision> {
    const { connection, issuer, bearer, grant } = await this.decidable(owner, podId, grantId, signal)
    if (grant.status !== 'pending') throw new Error(`This grant is ${grant.status}; only a pending grant can be denied`)
    const denied = await connectionRequest(issuer, `/api/grants/${encodeURIComponent(grantId)}/deny`, {}, signal, bearer) as unknown as Grant
    if (denied.id !== grantId || denied.status !== 'denied') throw new Error('The identity provider did not deny this grant')
    return this.decided(podId, connection, denied, false, typeOf(grant.request.grant_type))
  }

  /**
   * Revokes a Pod grant and records the IdP state; a grant the IdP already shows as ended only updates the ledger. A
   * direct Pod identity revokes its own grant, which only reduces authority. A brokered grant exists only at the
   * owner's decision IdP, where only the owner may revoke it, and the agent provider does not forward a revoke, so it
   * needs the owner session.
   */
  async revoke(owner: OwnerSession | null, podId: string, grantId: string, signal: AbortSignal): Promise<GrantResult> {
    const connection = await this.dependencies.connection(podId)
    const grant = await this.read(connection, grantId, signal)
    if (endedStates.includes(grant.status)) return this.result(await this.record(podId, connection, grant))
    const reply = connection.brokered
      ? await this.revokeAsOwner(owner, podId, grantId, signal)
      : await connectionRequest(connection.issuer, `/api/grants/${encodeURIComponent(grantId)}/revoke`, {}, signal, await connection.accessToken())
    if (reply.status !== 'revoked') throw new Error('The identity provider did not revoke this grant')
    return this.result(await this.record(podId, connection, { ...grant, status: 'revoked' }))
  }

  private async revokeAsOwner(owner: OwnerSession | null, podId: string, grantId: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (!owner) throw new Error('Revoking a brokered Pod grant needs an active owner session (the MCP sign-in); otherwise the owner revokes it at the IdP')
    const { issuer, bearer } = await this.decidable(owner, podId, grantId, signal)
    return await connectionRequest(issuer, `/api/grants/${encodeURIComponent(grantId)}/revoke`, {}, signal, bearer)
  }

  /** The grant read with the owner's token and checked against this owner's Pod identity, before any decision. */
  private async decidable(owner: OwnerSession | null, podId: string, grantId: string, signal: AbortSignal) {
    if (!owner) throw new Error('Deciding a grant needs an active owner session (the MCP sign-in); otherwise the owner decides at the IdP')
    if (!grantIdPattern.test(grantId)) throw new Error('Invalid grant identity')
    const bearer = await owner.bearer(signal)
    const connection = await this.dependencies.connection(podId)
    const issuer = connection.decisionIssuer ?? connection.issuer
    if (issuer !== owner.issuer || connection.owner !== owner.account) throw new Error('This Pod belongs to another owner or identity provider than the signed-in owner')
    const grant = await readJSON(await fetch(`${issuer}/api/grants/${encodeURIComponent(grantId)}`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${bearer}` } })) as unknown as Grant
    if (grant.id !== grantId || grant.request?.requester !== connection.subject || grant.request.target_host !== connection.targetHost || !['shapes', approvalAudience, 'pods-mail-archive'].includes(grant.request.audience) || !sameBrokeredGrant(grant.brokered, connection.brokered)) throw new Error('This grant was not requested by this Pod for itself; it is decided at the IdP only')
    return { connection, issuer, bearer, grant }
  }

  private async decided(podId: string, connection: PodConnection, grant: Grant, inSession: boolean, requestedType: GrantType): Promise<GrantDecision> {
    const recorded = grant.request.audience === 'shapes' && grantCoverage(grant).length ? await this.record(podId, connection, grant, inSession) : null
    const grantType = typeOf(grant.request.grant_type)
    return { id: grant.id, podId, state: stateOf(grant.status), grantType, requestedType, widened: grantType !== requestedType, approvedInSession: inSession, grant: recorded }
  }

  /**
   * Adopts an earlier grant of this Pod identity that the ledger does not hold, so the owner is not asked again: an
   * approved continuing grant first, else a pending continuing request. Candidates are the grant ids this Pod's runs
   * observed (their approval events); each is read at the IdP as this identity and must cover every detail. The
   * IdP keeps no listing for brokered identities and does not return an existing grant for a new brokered request.
   */
  async adopt(podId: string, connection: AgentConnection, details: OpenApeCliAuthorizationDetail[], read: (id: string) => Promise<Grant | null>): Promise<Grant | null> {
    const cliId = details[0]?.cli_id
    if (!cliId) return null
    const ids = await this.dependencies.ledger({ type: 'observed', podId, issuer: connection.decisionIssuer ?? connection.issuer, subject: connection.subject, cliId }) as string[]
    let pending: Grant | null = null
    for (const id of ids) {
      const key = `${podId}\n${id}`
      if (this.checked.has(key)) continue
      const grant = await read(id)
      const usable = !!grant && ownGrant(grant, id, connection) && grant.request.grant_type !== 'once' && cliAuthorizationDetailsCover(grantCoverage(grant), details)
      if (usable && grant.status === 'approved') return grant
      if (usable && grant.status === 'pending') pending ??= grant
      else this.checked.add(key)
    }
    return pending
  }

  /** A grant read as the Pod identity; null when the IdP does not show it to this identity. */
  private async candidate(connection: AgentConnection, grantId: string, signal: AbortSignal): Promise<Grant | null> {
    if (!grantIdPattern.test(grantId)) return null
    const response = await fetch(`${connection.issuer}/api/grants/${encodeURIComponent(grantId)}`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${await connection.accessToken()}` } })
    if (response.status === 403 || response.status === 404) { await response.body?.cancel(); return null }
    return await readJSON(response) as unknown as Grant
  }

  private async read(connection: AgentConnection, grantId: string, signal: AbortSignal): Promise<Grant> {
    const grant = await readJSON(await fetch(`${connection.issuer}/api/grants/${encodeURIComponent(grantId)}`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${await connection.accessToken()}` } })) as unknown as Grant
    if (grant.id !== grantId || grant.request?.requester !== connection.subject || grant.request.target_host !== connection.targetHost || !sameBrokeredGrant(grant.brokered, connection.brokered)) throw new Error('Grant does not belong to this Pod identity')
    return grant
  }

  private async record(podId: string, connection: AgentConnection, grant: Grant, approvedInSession = false): Promise<PodGrant> {
    const details = grantCoverage(grant)
    const cliId = details[0]?.cli_id
    if (!cliId || details.some(detail => detail.cli_id !== cliId)) throw new Error('A Pod grant covers exactly one program')
    const now = Date.now()
    const value = parsePodGrant({ id: grant.id, podId, issuer: connection.decisionIssuer ?? connection.issuer, subject: connection.subject, cliId, details, display: details.map(detail => detail.display).join('; ').slice(0, 4096), grantType: typeOf(grant.request.grant_type), state: stateOf(grant.status), approvedInSession, createdAt: typeof grant.created_at === 'number' ? grant.created_at * 1000 : now, updatedAt: now })
    await this.dependencies.ledger({ type: 'record', grant: value })
    return value
  }

  private result(grant: PodGrant): GrantResult {
    return { grant, approval: grant.state === 'pending' ? approvalURL({ grantId: grant.id, issuer: grant.issuer, state: 'pending', title: grant.display }) : null }
  }
}
