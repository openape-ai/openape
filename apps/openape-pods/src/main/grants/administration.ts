import { grantView } from '../../contracts/grants'
import type { DelegateCommand, GrantDeclaration, GrantsCommand, PodGrant } from '../../contracts/grants'
import { readJSON } from '../connections/http'
import type { HttpPermission } from '../../contracts/http'
import { parseHttpAuthentication } from '../../contracts/http'
import { programIdentity } from '../../contracts/programs'
import type { ProgramAssignment, ProgramDefinition } from '../../contracts/programs'
import type { DirectoryAccess, PodResource, ResourceState } from '../../contracts/resources'
import type { SandboxCommand, SandboxDeclaration, SandboxView } from '../../contracts/sandbox'
import type { GrantLedgerCommand } from '../../worker/resources/grants'
import { modelResources } from '../../worker/master/resources'
import type { OwnerSession } from '../connections/owner-session'
import { verifyProgram } from '../programs/session'
import { httpSpec, runtimeSpec } from './pod-grants'
import type { PodGrants } from './pod-grants'

type ProgramEntry = NonNullable<SandboxDeclaration['programs']>[number]
/** The desktop operations the MCP grant and sandbox actions reuse; each one keeps its own checks. */
export interface Administration {
  grants: PodGrants
  resources: (podId: string) => Promise<ResourceState>
  podName: (podId: string) => Promise<string>
  ledger: (command: GrantLedgerCommand) => Promise<unknown>
  programDefinition: (entry: ProgramEntry) => Promise<ProgramDefinition>
  addProgram: (podId: string, definition: ProgramDefinition) => Promise<void>
  assignHttp: (podId: string, permission: HttpPermission) => Promise<void>
  assignDirectory: (podId: string, path: string, access: DirectoryAccess) => Promise<void>
  importSecret: (podId: string, alias: string, path: string) => Promise<void>
}
interface Outcome { podId: string, display: string, grantId?: string, state?: string, approvedInSession?: boolean, approval?: string, error?: string }

const ready = (resources: PodResource[]) => resources.filter(item => item.state === 'ready')

function application(resources: PodResource[], name: string): ProgramAssignment {
  const matches = ready(resources).filter(item => item.configuration.type === 'program' && (item.id === name || item.name === name || item.configuration.cliId === name))
  if (matches.length !== 1) throw new Error(matches.length ? `Application ${name} is ambiguous; use its resource ID` : `Application ${name} is not in this Pod's sandbox; assign it before granting its commands`)
  return matches[0]!.configuration as unknown as ProgramAssignment
}

/** One declared grant: what it shows and how it is requested as the Pod; the result carries the grant and, when pending, its IdP page. */
interface DeclaredGrant { display: string, request: (signal: AbortSignal) => Promise<{ grantId: string, state: string, approvedInSession: boolean, display: string, approval: string | null }> }

async function declaredGrants(podId: string, declaration: GrantDeclaration, admin: Administration): Promise<DeclaredGrant[]> {
  const { resources } = await admin.resources(podId)
  const permission = (spec: () => Promise<ReturnType<typeof runtimeSpec>>) => async (signal: AbortSignal) => {
    const { grant, approval } = await admin.grants.request(podId, await spec(), signal)
    return { grantId: grant.id, state: grant.state, approvedInSession: grant.approvedInSession, display: grant.display, approval }
  }
  return [
    ...(declaration.runtime ? [{ display: 'Run the stored Pod script', request: permission(async () => runtimeSpec(podId, await admin.podName(podId))) }] : []),
    ...(declaration.programs ?? []).map(entry => ({
      display: entry.argv ? `${entry.application} ${entry.argv.join(' ')}` : `${entry.application} (whole program)`,
      // The IdP decides what a command means and which grant covers it (issue 1473, revision 4); a whole program is granted there.
      request: async (signal: AbortSignal) => {
        if (!entry.argv) throw new Error(`A grant for every ${entry.application} command is decided at the IdP; declare one command with argv, or widen an approved command there`)
        const assignment = application(resources, entry.application)
        await verifyProgram(assignment)
        const display = `${assignment.cliId} ${entry.argv.join(' ')}`
        const { grantId, approval } = await admin.grants.requestProgram(podId, { program: programIdentity(assignment), argv: entry.argv }, signal)
        return { grantId, state: approval ? 'pending' : 'approved', approvedInSession: false, display, approval }
      },
    })),
    ...(declaration.http ?? []).map(entry => ({ display: `${entry.origin}${entry.methods ? ` ${entry.methods.join(',')}` : ''}`, request: permission(async () => httpSpec(entry.origin, entry.methods)) })),
  ]
}

/**
 * Requests each declared grant as the Pod and, when `approve` is true and an owner session is active, approves it right away as continuing. Without an
 * owner session the requests stay pending and the result carries their IdP pages. Repeating it never asks twice.
 */
async function requestGrants(podId: string, declaration: GrantDeclaration, approve: boolean, owner: OwnerSession | null, admin: Administration, signal: AbortSignal): Promise<Outcome[]> {
  const outcomes: Outcome[] = []
  for (const item of await declaredGrants(podId, declaration, admin)) {
    try {
      const requested = await item.request(signal)
      if (requested.approval && approve && owner) {
        const decision = await admin.grants.approve(owner, podId, requested.grantId, 'always', signal)
        outcomes.push({ podId, display: requested.display, grantId: requested.grantId, state: decision.state, approvedInSession: true })
      }
      else {
        outcomes.push({ podId, display: requested.display, grantId: requested.grantId, state: requested.state, approvedInSession: requested.approvedInSession, ...(requested.approval ? { approval: requested.approval } : {}) })
      }
    }
    catch (error) { outcomes.push({ podId, display: item.display, error: error instanceof Error ? error.message : 'Grant request failed' }) }
  }
  return outcomes
}

function listed(grant: PodGrant) {
  return { ...grantView(grant), ...(grant.state === 'pending' ? { approval: new URL(`/grant-approval?grant_id=${encodeURIComponent(grant.id)}`, grant.issuer).href } : {}) }
}

/** The one DDISA agent a Pod's ready HTTP destinations authenticate as at `issuer`; never a free choice of the caller. */
function podAgent(resources: PodResource[], issuer: string): string {
  const subjects = new Set(ready(resources).flatMap((item) => {
    if (item.configuration.type !== 'http' || item.configuration.authentication === undefined) return []
    const authentication = parseHttpAuthentication(item.configuration.authentication)
    return authentication.issuer === issuer ? [authentication.subject] : []
  }))
  if (subjects.size !== 1) throw new Error('A delegation goes to the one DDISA agent this Pod authenticates as at your identity provider; assign the Pod exactly one such HTTP destination first')
  return [...subjects][0]!
}

/**
 * Creates a delegation as the signed-in owner, like the owner's own `apes grants delegate`, but only to the agent of one
 * of this desktop's Pods, only for the IdP itself as audience, only with grants scopes and for at most 90 days. Renewing
 * creates a new delegation; the owner revokes one at the IdP.
 */
async function delegate(command: DelegateCommand, owner: OwnerSession | null, admin: Administration, signal: AbortSignal): Promise<unknown> {
  if (!owner) throw new Error('Creating a delegation needs an active owner session (the MCP sign-in)')
  const agent = podAgent((await admin.resources(command.podId)).resources, owner.issuer)
  const body = { delegate: agent, audience: owner.issuer, scopes: command.scopes, grant_type: 'timed', duration: command.days * 86400 }
  const response = await fetch(`${owner.issuer}/api/delegations`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await owner.bearer(signal)}` }, body: JSON.stringify(body) })
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { title?: unknown } | null
    const reason = typeof problem?.title === 'string' ? problem.title.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').slice(0, 300) : 'no reason given'
    throw new Error(`The identity provider refused the delegation (${response.status}): ${reason}`)
  }
  const created = await readJSON(response)
  const request = created.request as Record<string, unknown> | undefined
  if (typeof created.id !== 'string' || created.status !== 'approved' || request?.delegate !== agent || request.audience !== owner.issuer) throw new Error('The identity provider did not create the delegation')
  return { delegation: created.id, issuer: owner.issuer, podId: command.podId, delegate: agent, audience: owner.issuer, scopes: command.scopes, ...(typeof created.expires_at === 'number' ? { expiresAt: created.expires_at } : {}) }
}

export async function administerGrants(command: GrantsCommand, owner: OwnerSession | null, admin: Administration): Promise<unknown> {
  const signal = AbortSignal.timeout(170000)
  if (command.type === 'delegate') return delegate(command, owner, admin, signal)
  if (command.type === 'list') return { grants: (await admin.grants.list({ podId: command.podId })).map(listed), session: owner ? { active: true, endsAt: owner.endsAt } : { active: false } }
  if (command.type === 'request') {
    return { outcomes: await requestGrants(command.target.podId, command.grants, command.approve !== false, owner, admin, signal) }
  }
  if (command.type === 'approve') return admin.grants.approve(owner, command.podId, command.grantId, command.grantType, signal)
  if (command.type === 'deny') return admin.grants.deny(owner, command.podId, command.grantId, signal)
  return admin.grants.revoke(owner, command.podId, command.grantId, signal)
}

/** Applies a sandbox declaration to one Pod; entries it already has are kept, so a repeated declaration changes nothing. */
async function applySandbox(podId: string, declaration: SandboxDeclaration, admin: Administration): Promise<{ applications: string[], kept: string[] }> {
  const kept: string[] = []
  if (declaration.level) await admin.ledger({ type: 'level', podId, level: declaration.level })
  if (declaration.deny) await admin.ledger({ type: 'deny', podId, deny: declaration.deny })
  const applications: string[] = []
  const track = async (change: () => Promise<void>) => {
    const before = new Set((await admin.resources(podId)).resources.map(item => item.id))
    await change()
    return ready((await admin.resources(podId)).resources).filter(item => !before.has(item.id))
  }
  for (const entry of declaration.programs ?? []) {
    const definition = await admin.programDefinition(entry)
    const existing = ready((await admin.resources(podId)).resources).find(item => item.configuration.type === 'program' && item.configuration.cliId === definition.cliId && item.configuration.executable === definition.executable && item.configuration.executableHash === definition.executableHash)
    applications.push(existing ? existing.id : (await track(() => admin.addProgram(podId, definition)))[0]!.id)
  }
  for (const permission of declaration.http ?? []) {
    const existing = ready((await admin.resources(podId)).resources).find(item => item.configuration.type === 'http' && item.configuration.origin === permission.origin)
    // An origin the Pod already reaches keeps its own assignment (methods, capability and authentication); it is never replaced.
    if (existing) {
      if (!permission.methods.every(method => (existing.configuration.methods as string[]).includes(method))) kept.push(`${permission.origin} keeps its existing methods ${(existing.configuration.methods as string[]).join(', ')}`)
      continue
    }
    await track(() => admin.assignHttp(podId, permission))
  }
  for (const directory of declaration.directories ?? []) {
    if (ready((await admin.resources(podId)).resources).some(item => item.kind === 'directory' && item.configuration.path === directory.path && item.configuration.access === directory.access)) continue
    await track(() => admin.assignDirectory(podId, directory.path, directory.access))
  }
  for (const secret of declaration.secrets ?? []) {
    if (ready((await admin.resources(podId)).resources).some(item => item.kind === 'credential' && item.configuration.alias === secret.alias)) continue
    await track(() => admin.importSecret(podId, secret.alias, secret.path))
  }
  return { applications, kept }
}

async function show(podId: string, admin: Administration) {
  const state = await admin.resources(podId)
  return { podId, sandbox: await admin.ledger({ type: 'sandbox', podId }) as SandboxView, resources: modelResources(state.resources), epoch: state.epoch, grants: (await admin.grants.list({ podId })).map(listed) }
}

/**
 * The sandbox (what a Pod CAN reach). With `grants`, the same call
 * requests the grants (what they MAY do) and approves them in the owner session; `grants: 'sandbox'` grants exactly
 * the Pod script and the declared HTTP origins with their methods; program commands are authorized by the IdP per call
 * (issue 1473, revision 4), so their first call asks the owner.
 */
export async function administerSandbox(command: SandboxCommand, owner: OwnerSession | null, admin: Administration): Promise<unknown> {
  const { podId } = command.target
  if (command.type === 'show') return { pods: [await show(podId, admin)] }
  const result = await applySandbox(podId, command.sandbox, admin)
  const kept = result.kept.map(entry => ({ podId, entry }))
  if (!command.grants) return { pods: [await show(podId, admin)], kept }
  const declaration: GrantDeclaration = command.grants === 'sandbox'
    ? { runtime: true, http: (command.sandbox.http ?? []).map(entry => ({ origin: entry.origin, methods: entry.methods })) }
    : command.grants
  const outcomes = await requestGrants(podId, declaration, command.approve !== false, owner, admin, AbortSignal.timeout(170000))
  return { pods: [await show(podId, admin)], kept, outcomes }
}
