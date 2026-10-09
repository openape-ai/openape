import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { canonicalizeCliPermission, sameBrokeredGrant } from '@openape/grants'
import { loadAdapter, resolveCommand } from '@openape/apes'
import type { LoadedAdapter } from '@openape/apes'
import { approvalURL } from '../../contracts/activity'
import { gateAudience } from '../../contracts/gates'
import { parsePodGrant } from '../../contracts/grants'
import type { GrantOrigin, GrantState, GrantType, PodGrant } from '../../contracts/grants'
import type { ProgramAssignment } from '../../contracts/programs'
import { grantCoverage } from '../broker/authorization'
import type { AgentConnection, Grant, GrantLedgerPort } from '../broker/authorization'
import { connectionRequest, readJSON } from '../connections/http'
import type { OwnerSession } from '../connections/owner-session'
import type { GrantLedgerCommand } from '../../worker/resources/grants'
import { verifyExecutable } from '../../worker/runtime/sandbox'

/** What one grant request asks for, as the Pod identity: the authorization details and the adapter they belong to. */
export interface GrantSpec { cliId: string, details: OpenApeCliAuthorizationDetail[], executionContext: { adapter_id: string, adapter_version: string, adapter_digest: string }, display: string }
export interface PodConnection extends AgentConnection { owner: string }
export interface GrantResult { grant: PodGrant, approval: string | null }
/** A decision made in the owner session; `grant` is the ledger entry when the grant is a Pod grant, not a network approval item. */
export interface GrantDecision { id: string, podId: string, state: GrantState, grantType: GrantType, approvedInSession: boolean, grant: PodGrant | null }

const grantIdPattern = /^[\w-]{1,128}$/
const riskOrder = ['low', 'medium', 'high', 'critical']

function context(adapter: LoadedAdapter): GrantSpec['executionContext'] {
  return { adapter_id: adapter.adapter.cli.id, adapter_version: adapter.adapter.cli.version ?? adapter.adapter.schema, adapter_digest: adapter.digest }
}

/**
 * The details of a whole-program grant: one per action and first resource, without selector, so every operation of
 * that action on that resource is covered. Operations the adapter marks as exact commands and generic execution are
 * never covered: such a group is left out and its commands need their own grant.
 */
export function programCoverage(adapter: LoadedAdapter): OpenApeCliAuthorizationDetail[] {
  const groups = new Map<string, { action: string, resource: string, risk: string, exact: boolean }>()
  for (const operation of adapter.adapter.operations) {
    if (operation.id === '_generic.exec') continue
    const resource = operation.resource_chain[0]?.split(':', 1)[0]
    if (!resource) continue
    const key = `${operation.action}\n${resource}`
    const group = groups.get(key) ?? { action: operation.action, resource, risk: 'low', exact: false }
    if (riskOrder.indexOf(operation.risk) > riskOrder.indexOf(group.risk)) group.risk = operation.risk
    group.exact ||= operation.exact_command === true
    groups.set(key, group)
  }
  return [...groups.values()].filter(group => !group.exact).map((group) => {
    const detail = { type: 'openape_cli' as const, cli_id: adapter.adapter.cli.id, operation_id: '*', resource_chain: [{ resource: group.resource }], action: group.action, permission: '', display: `${adapter.adapter.cli.id}: every ${group.action} on ${group.resource}`, risk: group.risk as OpenApeCliAuthorizationDetail['risk'] }
    return { ...detail, permission: canonicalizeCliPermission(detail) }
  })
}

/** A whole program, or one command when `argv` is given, of an application assigned to the Pod. */
export async function programSpec(assignment: Pick<ProgramAssignment, 'cliId' | 'adapterPath' | 'adapterHash'>, argv?: string[]): Promise<GrantSpec> {
  await verifyExecutable(assignment.adapterPath, assignment.adapterHash)
  const adapter = loadAdapter(assignment.cliId, assignment.adapterPath)
  if (argv) {
    const resolved = await resolveCommand(adapter, [assignment.cliId, ...argv])
    if (resolved.detail.operation_id === '_generic.exec') throw new Error('Generic program execution cannot be granted')
    return { cliId: assignment.cliId, details: [resolved.detail], executionContext: context(adapter), display: resolved.detail.display }
  }
  const details = programCoverage(adapter)
  if (!details.length) throw new Error(`${assignment.cliId} has no operations a whole-program grant can cover; grant single commands`)
  return { cliId: assignment.cliId, details, executionContext: context(adapter), display: `All ${assignment.cliId} operations: ${details.map(detail => `${detail.action} on ${detail.resource_chain[0]!.resource}`).join(', ')}` }
}

/** The grant to run the Pod's stored script; it covers every run of this Pod whatever its script, workspace or name. */
export async function runtimeSpec(adapterPath: string, podId: string, name: string): Promise<GrantSpec> {
  const adapter = loadAdapter('pod-runtime', adapterPath)
  const resolved = await resolveCommand(adapter, ['pod-runtime', 'run', '--pod', podId, '--name', name, '--script', 'run.mjs', '--workspace', 'workspace'])
  return { cliId: 'pod-runtime', details: [resolved.detail], executionContext: context(adapter), display: resolved.detail.display }
}

/** An HTTPS origin; with methods, one detail per method, otherwise every method of that origin. */
export async function httpSpec(adapterPath: string, origin: string, methods?: string[]): Promise<GrantSpec> {
  const adapter = loadAdapter('pod-http', adapterPath)
  if (methods) {
    const details = await Promise.all(methods.map(async method => (await resolveCommand(adapter, ['pod-http', 'request', '--origin', origin, '--method', method])).detail))
    return { cliId: 'pod-http', details, executionContext: context(adapter), display: details.map(detail => detail.display).join('; ') }
  }
  const detail = { type: 'openape_cli' as const, cli_id: 'pod-http', operation_id: 'request', resource_chain: [{ resource: 'https-origin', selector: { url: origin } }], action: 'request', permission: '', display: `HTTP requests to ${origin}`, risk: 'high' as const }
  return { cliId: 'pod-http', details: [{ ...detail, permission: canonicalizeCliPermission(detail) }], executionContext: context(adapter), display: detail.display }
}

function stateOf(status: string): GrantState {
  if (!['pending', 'approved', 'denied', 'revoked', 'expired', 'used'].includes(status)) throw new Error(`Unexpected grant status ${status}`)
  return status as GrantState
}

/**
 * The Pod grants: requested by the Pod identity, recorded in the ledger with their origin, and decided by the owner.
 * `approve` and `deny` are the only Pods code that decides a grant. They need the owner session of an MCP call, use
 * its token and check before deciding that the grant was requested by this owner's Pod identity for this Pod.
 */
export class PodGrants {
  constructor(private readonly dependencies: { connection: (podId: string) => Promise<PodConnection>, ledger: (command: GrantLedgerCommand) => Promise<unknown> }) {}

  /** The ledger as one Pod's authority uses it. */
  port(podId: string): GrantLedgerPort {
    return {
      find: async (detail, connection) => (await this.dependencies.ledger({ type: 'find', podId, issuer: connection.decisionIssuer ?? connection.issuer, subject: connection.subject, detail }) as string | null) ?? undefined,
      record: async (grant, connection) => { if (grant.request.audience === 'shapes' && grantCoverage(grant).length) await this.record(podId, connection, grant) },
    }
  }

  async list(filter: { podId?: string, networkId?: string }): Promise<PodGrant[]> {
    return await this.dependencies.ledger({ type: 'list', ...filter }) as PodGrant[]
  }

  /** Requests one continuing grant as the Pod; an equal pending or approved request is reused, so retries never ask twice. */
  async request(podId: string, spec: GrantSpec, origin: GrantOrigin | null, signal: AbortSignal): Promise<GrantResult> {
    const connection = await this.dependencies.connection(podId)
    const issuer = connection.decisionIssuer ?? connection.issuer
    const existing = await this.dependencies.ledger({ type: 'same', podId, issuer, subject: connection.subject, details: spec.details }) as PodGrant | null
    if (existing) {
      const current = await this.record(podId, connection, await this.read(connection, existing.id, signal), origin)
      if (['pending', 'approved'].includes(current.state)) return this.result(current)
    }
    const created = await connectionRequest(connection.issuer, '/api/grants', { requester: connection.subject, target_host: connection.targetHost, audience: 'shapes', grant_type: 'always', permissions: spec.details.map(detail => detail.permission), authorization_details: spec.details, execution_context: spec.executionContext, reason: `${spec.display} (Pod ${podId})`.slice(0, 4096) }, signal, await connection.accessToken())
    if (typeof created.id !== 'string' || !grantIdPattern.test(created.id)) throw new Error('Invalid grant response; inspect the Pod grants before retrying')
    return this.result(await this.record(podId, connection, await this.read(connection, created.id, signal), origin))
  }

  /** Approves as the signed-in owner. Without an active owner session this throws before any IdP call. */
  async approve(owner: OwnerSession | null, podId: string, grantId: string, grantType: GrantType | undefined, signal: AbortSignal): Promise<GrantDecision> {
    const { connection, issuer, bearer, grant } = await this.decidable(owner, podId, grantId, signal)
    if (grant.status === 'approved') return this.decided(podId, connection, grant, false)
    if (grant.status !== 'pending') throw new Error(`This grant is ${grant.status}; request it again instead`)
    const type = grantType ?? (grant.request.grant_type === 'once' ? 'once' : 'always')
    const reply = await connectionRequest(issuer, `/api/grants/${encodeURIComponent(grantId)}/approve`, { grant_type: type }, signal, bearer)
    const approved = reply.grant as Grant | undefined
    if (approved?.id !== grantId || approved.status !== 'approved') throw new Error('The identity provider did not approve this grant')
    return this.decided(podId, connection, approved, true)
  }

  async deny(owner: OwnerSession | null, podId: string, grantId: string, signal: AbortSignal): Promise<GrantDecision> {
    const { connection, issuer, bearer, grant } = await this.decidable(owner, podId, grantId, signal)
    if (grant.status !== 'pending') throw new Error(`This grant is ${grant.status}; only a pending grant can be denied`)
    const denied = await connectionRequest(issuer, `/api/grants/${encodeURIComponent(grantId)}/deny`, {}, signal, bearer) as unknown as Grant
    if (denied.id !== grantId || denied.status !== 'denied') throw new Error('The identity provider did not deny this grant')
    return this.decided(podId, connection, denied, false)
  }

  /** Revokes as the requesting Pod identity, which only reduces authority and needs no owner session. */
  async revoke(podId: string, grantId: string, signal: AbortSignal): Promise<GrantResult> {
    const connection = await this.dependencies.connection(podId)
    const grant = await this.read(connection, grantId, signal)
    if (['revoked', 'denied', 'expired', 'used'].includes(grant.status)) return this.result(await this.record(podId, connection, grant))
    const reply = await connectionRequest(connection.issuer, `/api/grants/${encodeURIComponent(grantId)}/revoke`, {}, signal, await connection.accessToken())
    if (reply.status !== 'revoked') throw new Error('The identity provider did not revoke this grant')
    return this.result(await this.record(podId, connection, { ...grant, status: 'revoked' }))
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
    if (grant.id !== grantId || grant.request?.requester !== connection.subject || grant.request.target_host !== connection.targetHost || !['shapes', gateAudience, 'pods-mail-archive'].includes(grant.request.audience) || !sameBrokeredGrant(grant.brokered, connection.brokered)) throw new Error('This grant was not requested by this Pod for itself; it is decided at the IdP only')
    return { connection, issuer, bearer, grant }
  }

  private async decided(podId: string, connection: PodConnection, grant: Grant, inSession: boolean): Promise<GrantDecision> {
    const recorded = grant.request.audience === 'shapes' && grantCoverage(grant).length ? await this.record(podId, connection, grant, null, inSession) : null
    return { id: grant.id, podId, state: stateOf(grant.status), grantType: grant.request.grant_type === 'once' ? 'once' : 'always', approvedInSession: inSession, grant: recorded }
  }

  private async read(connection: AgentConnection, grantId: string, signal: AbortSignal): Promise<Grant> {
    const grant = await readJSON(await fetch(`${connection.issuer}/api/grants/${encodeURIComponent(grantId)}`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${await connection.accessToken()}` } })) as unknown as Grant
    if (grant.id !== grantId || grant.request?.requester !== connection.subject || grant.request.target_host !== connection.targetHost || !sameBrokeredGrant(grant.brokered, connection.brokered)) throw new Error('Grant does not belong to this Pod identity')
    return grant
  }

  private async record(podId: string, connection: AgentConnection, grant: Grant, origin: GrantOrigin | null = null, approvedInSession = false): Promise<PodGrant> {
    const details = grantCoverage(grant)
    const cliId = details[0]?.cli_id
    if (!cliId || details.some(detail => detail.cli_id !== cliId)) throw new Error('A Pod grant covers exactly one program')
    const now = Date.now()
    const value = parsePodGrant({ id: grant.id, podId, issuer: connection.decisionIssuer ?? connection.issuer, subject: connection.subject, cliId, details, display: details.map(detail => detail.display).join('; ').slice(0, 4096), grantType: grant.request.grant_type === 'once' ? 'once' : 'always', state: stateOf(grant.status), origin, approvedInSession, createdAt: typeof grant.created_at === 'number' ? grant.created_at * 1000 : now, updatedAt: now })
    await this.dependencies.ledger({ type: 'record', grant: value })
    return value
  }

  private result(grant: PodGrant): GrantResult {
    return { grant, approval: grant.state === 'pending' ? approvalURL({ grantId: grant.id, issuer: grant.issuer, state: 'pending', title: grant.display }) : null }
  }
}
