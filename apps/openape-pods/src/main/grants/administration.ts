import { join } from 'node:path'
import { grantView } from '../../contracts/grants'
import type { GrantDeclaration, GrantOrigin, GrantsCommand, GrantTarget, PodGrant } from '../../contracts/grants'
import type { HttpPermission } from '../../contracts/http'
import type { NetworkView } from '../../contracts/networks'
import type { ProgramAssignment, ProgramDefinition } from '../../contracts/programs'
import type { DirectoryAccess, PodResource, ResourceState } from '../../contracts/resources'
import type { SandboxCommand, SandboxDeclaration, SandboxView } from '../../contracts/sandbox'
import type { GrantLedgerCommand } from '../../worker/resources/grants'
import { modelResources } from '../../worker/master/resources'
import type { OwnerSession } from '../connections/owner-session'
import { httpSpec, programSpec, runtimeSpec } from './pod-grants'
import type { GrantSpec, PodGrants } from './pod-grants'

type ProgramEntry = NonNullable<SandboxDeclaration['programs']>[number]
/** The desktop operations the MCP grant and sandbox actions reuse; each one keeps its own checks. */
export interface Administration {
  grants: PodGrants
  vendor: string
  resources: (podId: string) => Promise<ResourceState>
  podName: (podId: string) => Promise<string>
  networks: () => Promise<NetworkView>
  ledger: (command: GrantLedgerCommand) => Promise<unknown>
  programDefinition: (entry: ProgramEntry) => Promise<ProgramDefinition>
  addProgram: (podId: string, definition: ProgramDefinition) => Promise<void>
  assignHttp: (podId: string, permission: HttpPermission) => Promise<void>
  assignDirectory: (podId: string, path: string, access: DirectoryAccess) => Promise<void>
  importSecret: (podId: string, alias: string, path: string) => Promise<void>
}
interface Outcome { podId: string, display: string, grantId?: string, state?: string, approvedInSession?: boolean, approval?: string, error?: string }

const ready = (resources: PodResource[]) => resources.filter(item => item.state === 'ready')

/** The Pods a target names: one Pod, or every member of the given current network revision, which becomes the origin. */
async function targetPods(target: GrantTarget, admin: Administration): Promise<{ podIds: string[], origin: GrantOrigin | null }> {
  if ('podId' in target) return { podIds: [target.podId], origin: null }
  const network = (await admin.networks()).networks.find(item => item.id === target.networkId)
  if (!network || network.state === 'archived') throw new Error('The network is unknown or archived')
  if (network.revision !== target.revision) throw new Error(`The network is at revision ${network.revision}; read it again before declaring its sandbox or grants`)
  if (!network.podIds?.length) throw new Error('The network has no members')
  return { podIds: network.podIds, origin: { networkId: network.id, revision: network.revision } }
}

function application(resources: PodResource[], name: string): ProgramAssignment {
  const matches = ready(resources).filter(item => item.configuration.type === 'program' && (item.id === name || item.name === name || item.configuration.cliId === name))
  if (matches.length !== 1) throw new Error(matches.length ? `Application ${name} is ambiguous; use its resource ID` : `Application ${name} is not in this Pod's sandbox; a program grant needs its adapter`)
  return matches[0]!.configuration as unknown as ProgramAssignment
}

async function grantSpecs(podId: string, declaration: GrantDeclaration, admin: Administration): Promise<{ display: string, spec: () => Promise<GrantSpec> }[]> {
  const { resources } = await admin.resources(podId)
  return [
    ...(declaration.runtime ? [{ display: 'Run the stored Pod script', spec: async () => runtimeSpec(join(admin.vendor, 'pod-runtime-shapes.toml'), podId, await admin.podName(podId)) }] : []),
    ...(declaration.programs ?? []).map(entry => ({ display: entry.argv ? `${entry.application} ${entry.argv.join(' ')}` : `${entry.application} (whole program)`, spec: async () => programSpec(application(resources, entry.application), entry.argv) })),
    ...(declaration.http ?? []).map(entry => ({ display: `${entry.origin}${entry.methods ? ` ${entry.methods.join(',')}` : ''}`, spec: async () => httpSpec(join(admin.vendor, 'pod-http-shapes.toml'), entry.origin, entry.methods) })),
  ]
}

/**
 * Requests each declared grant as each target Pod (fanned out to every network member with the network as origin)
 * and, when `approve` is true and an owner session is active, approves it right away as continuing. Without an
 * owner session the requests stay pending and the result carries their IdP pages. Repeating it never asks twice.
 */
async function requestGrants(podIds: string[], origin: GrantOrigin | null, declaration: GrantDeclaration, approve: boolean, owner: OwnerSession | null, admin: Administration, signal: AbortSignal): Promise<Outcome[]> {
  const outcomes: Outcome[] = []
  for (const podId of podIds) {
    for (const item of await grantSpecs(podId, declaration, admin)) {
      try {
        const { grant, approval } = await admin.grants.request(podId, await item.spec(), origin, signal)
        if (approval && approve && owner) {
          const decision = await admin.grants.approve(owner, podId, grant.id, 'always', signal)
          outcomes.push({ podId, display: grant.display, grantId: grant.id, state: decision.state, approvedInSession: true })
        }
        else {
          outcomes.push({ podId, display: grant.display, grantId: grant.id, state: grant.state, approvedInSession: grant.approvedInSession, ...(approval ? { approval } : {}) })
        }
      }
      catch (error) { outcomes.push({ podId, display: item.display, error: error instanceof Error ? error.message : 'Grant request failed' }) }
    }
  }
  return outcomes
}

function listed(grant: PodGrant) {
  return { ...grantView(grant), ...(grant.state === 'pending' ? { approval: new URL(`/grant-approval?grant_id=${encodeURIComponent(grant.id)}`, grant.issuer).href } : {}) }
}

export async function administerGrants(command: GrantsCommand, owner: OwnerSession | null, admin: Administration): Promise<unknown> {
  const signal = AbortSignal.timeout(170000)
  if (command.type === 'list') return { grants: (await admin.grants.list({ podId: command.podId, networkId: command.networkId })).map(listed), session: owner ? { active: true, endsAt: owner.endsAt } : { active: false } }
  if (command.type === 'request') {
    const { podIds, origin } = await targetPods(command.target, admin)
    return { outcomes: await requestGrants(podIds, origin, command.grants, command.approve !== false, owner, admin, signal) }
  }
  if (command.type === 'approve') return admin.grants.approve(owner, command.podId, command.grantId, command.grantType, signal)
  if (command.type === 'deny') return admin.grants.deny(owner, command.podId, command.grantId, signal)
  return admin.grants.revoke(command.podId, command.grantId, signal)
}

/** Applies a sandbox declaration to one Pod; entries it already has are kept, so a repeated declaration changes nothing. */
async function applySandbox(podId: string, declaration: SandboxDeclaration, origin: GrantOrigin | null, admin: Administration): Promise<{ applications: string[], kept: string[] }> {
  const kept: string[] = []
  const source = origin ? `network:${origin.networkId}` : 'pod'
  if (declaration.level) await admin.ledger({ type: 'level', podId, source, revision: origin?.revision ?? null, level: declaration.level })
  if (declaration.deny) await admin.ledger({ type: 'deny', podId, source, revision: origin?.revision ?? null, deny: declaration.deny })
  const applications: string[] = []
  const track = async (change: () => Promise<void>) => {
    const before = new Set((await admin.resources(podId)).resources.map(item => item.id))
    await change()
    const added = ready((await admin.resources(podId)).resources).filter(item => !before.has(item.id))
    if (origin) {
      for (const item of added) await admin.ledger({ type: 'networkResource', networkId: origin.networkId, revision: origin.revision, podId, resourceId: item.id })
    }
    return added
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
 * The sandbox (what Pods CAN reach) of a Pod or of every member of a network revision. With `grants`, the same call
 * requests the grants (what they MAY do) and approves them in the owner session; `grants: 'sandbox'` grants exactly
 * the declared programs as whole programs and the declared HTTP origins with their methods.
 */
export async function administerSandbox(command: SandboxCommand, owner: OwnerSession | null, admin: Administration): Promise<unknown> {
  const { podIds, origin } = await targetPods(command.target, admin)
  if (command.type === 'show') return { pods: await Promise.all(podIds.map(async podId => show(podId, admin))) }
  const applied: Record<string, string[]> = {}
  const kept: { podId: string, entry: string }[] = []
  for (const podId of podIds) {
    const result = await applySandbox(podId, command.sandbox, origin, admin)
    applied[podId] = result.applications
    kept.push(...result.kept.map(entry => ({ podId, entry })))
  }
  if (!command.grants) return { pods: await Promise.all(podIds.map(async podId => show(podId, admin))), kept }
  const signal = AbortSignal.timeout(170000)
  const outcomes: Outcome[] = []
  for (const podId of podIds) {
    const declaration: GrantDeclaration = command.grants === 'sandbox'
      ? { runtime: true, programs: applied[podId]!.map(id => ({ application: id })), http: (command.sandbox.http ?? []).map(entry => ({ origin: entry.origin, methods: entry.methods })) }
      : command.grants
    outcomes.push(...await requestGrants([podId], origin, declaration, command.approve !== false, owner, admin, signal))
  }
  return { pods: await Promise.all(podIds.map(async podId => show(podId, admin))), kept, outcomes }
}

/** Revokes, as each member Pod, the grants an archived network handed out and removes the sandbox resources it added. */
export async function releaseArchivedNetworkGrants(dependencies: { grants: PodGrants, ledger: (command: GrantLedgerCommand) => Promise<unknown>, resources: (podId: string) => Promise<ResourceState>, revokeResource: (podId: string, id: string, revision: number) => Promise<void> }, signal: AbortSignal): Promise<void> {
  const released = await dependencies.ledger({ type: 'released' }) as { grants: PodGrant[], resources: { networkId: string, podId: string, resourceId: string }[] }
  // One failing item must not hold back the others; every failure is reported and retried on the next pass.
  const failures: unknown[] = []
  for (const grant of released.grants) {
    try { await dependencies.grants.revoke(grant.podId, grant.id, signal) }
    catch (error) { failures.push(error) }
  }
  for (const item of released.resources) {
    try {
      const resource = (await dependencies.resources(item.podId)).resources.find(entry => entry.id === item.resourceId)
      if (resource && resource.state !== 'revoked') await dependencies.revokeResource(item.podId, resource.id, resource.revision)
      await dependencies.ledger({ type: 'resourceReleased', networkId: item.networkId, resourceId: item.resourceId })
    }
    catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length} grants or sandbox entries of archived networks were not released`)
}
