import { gateAudience, networkGateItemCommand, networkGateItemSummary, parseNetworkGateManifest } from '../../contracts/network-gates'
import type { NetworkGateManifest, NetworkGateRelease } from '../../contracts/network-gates'
import type { ServiceScope } from '../../contracts/services'
import type { ConnectionManager } from '../connections/manager'
import { createGrantAuthority } from './authority'
import type { BatchGrant, BatchMember } from './authority'

interface Request { body: unknown, scope: ServiceScope, connections: ConnectionManager, check: () => Promise<unknown>, checkGate?: (manifest: NetworkGateManifest, operation: string, grants?: BatchGrant[]) => Promise<unknown>, signal: AbortSignal }

/** One member per item, keyed by its network delivery. */
export function gateMembers(manifest: NetworkGateManifest): BatchMember[] {
  return manifest.items.map(item => ({ key: item.deliveryId, command: networkGateItemCommand(manifest, item), summary: networkGateItemSummary(item) }))
}

/** The grant identities a worker names, each matched to exactly one item of the frozen batch. */
function parseGrants(value: unknown, members: BatchMember[]): { grant: BatchGrant, member: BatchMember }[] {
  if (!Array.isArray(value) || !value.length || value.length > members.length) throw new Error('Invalid approval grant identities')
  const selected = value.map((entry) => {
    const grant = entry as BatchGrant
    const member = members.find(item => item.key === grant?.key)
    if (!grant || typeof grant !== 'object' || Object.keys(grant).some(key => !['key', 'id'].includes(key)) || typeof grant.id !== 'string' || !/^[\w-]{1,128}$/.test(grant.id) || !member) throw new Error('Invalid approval grant identities')
    return { grant: { key: grant.key, id: grant.id }, member }
  })
  if (new Set(selected.map(item => item.grant.key)).size !== selected.length) throw new Error('Duplicate approval grant identity')
  return selected
}

/** Requests, reads and consumes the per-item grants of one gate batch as the Pod that takes what the gate gives. */
export async function handleGate(input: Request): Promise<unknown> {
  const body = input.body as { operation?: unknown, manifest?: unknown, grants?: unknown }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !['create', 'status', 'consume', 'assertActive'].includes(body.operation as string) || Object.keys(body).some(key => !['operation', 'manifest', 'grants'].includes(key))) throw new Error('Invalid gate operation')
  const manifest = parseNetworkGateManifest(body.manifest)
  if (manifest.podId !== input.scope.podId) throw new Error('Gate batch belongs to another Pod')
  const members = gateMembers(manifest)
  const selected = body.operation === 'create' ? [] : parseGrants(body.grants, members)
  const check = async () => {
    await input.check()
    if (!input.checkGate) throw new Error('Network approval requires a current runtime gate context')
    await input.checkGate(manifest, body.operation as string, selected.map(item => item.grant))
  }
  await check()
  const connection = await input.connections.podConnection(input.scope.podId, manifest.owner, true)
  await check()
  // Approve routes accept the owner's once or always decision.
  const authority = createGrantAuthority(connection, input.signal, check, gateAudience, ['once', 'always'])
  if (body.operation === 'create') {
    const reply = await authority.createBatch({ id: manifest.id, title: manifest.title, expiresAt: manifest.expiresAt, reason: `${manifest.title}: approve this item`, permissions: [`graph.gate:${manifest.id}`], members })
    return { id: manifest.id, ...reply }
  }
  const bindings = selected.map(({ grant, member }) => ({ ...member, grantId: grant.id, expiresAt: manifest.expiresAt }))
  if (body.operation === 'status') return authority.statuses(manifest.id, bindings)
  for (const binding of bindings) {
    if (body.operation === 'assertActive') await authority.assertActive(binding)
    else await authority.consume(binding)
  }
  return true
}

/**
 * Revokes, as the requesting Pod, the grants of a finished network batch that the owner approved as always,
 * so they do not stay active at the IdP. It only reduces authority; once grants are already used up.
 */
export async function releaseNetworkGrants(release: NetworkGateRelease, connections: ConnectionManager, signal: AbortSignal): Promise<number> {
  const connection = await connections.podConnection(release.podId, release.owner, true)
  const authority = createGrantAuthority(connection, signal, async () => {}, gateAudience, ['once', 'always'])
  const members = gateMembers(release.manifest)
  const bindings = release.grants.map(grant => ({ ...members.find(member => member.key === grant.key)!, grantId: grant.id, expiresAt: release.manifest.expiresAt }))
  return authority.release(release.manifest.id, bindings)
}
