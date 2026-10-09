import { networkGateItemCommand, networkGateItemSummary, parseNetworkGateManifest } from '../../contracts/network-gates'
import type { NetworkGateManifest } from '../../contracts/network-gates'
import { gateAudience, gateItemCommand, gateItemSummary, parseGateManifest } from '../../contracts/gates'
import type { GateManifest } from '../../contracts/gates'
import type { ServiceScope } from '../../contracts/services'
import type { ConnectionManager } from '../connections/manager'
import { createGrantAuthority } from './authority'
import type { BatchGrant, BatchMember } from './authority'

interface Request { body: unknown, scope: ServiceScope, connections: ConnectionManager, check: () => Promise<unknown>, checkGate?: (manifest: NetworkGateManifest, operation: string, grants?: BatchGrant[]) => Promise<unknown>, signal: AbortSignal }

/** One member per item; network inputs are keyed by delivery, workflow items by item key. */
export function gateMembers(manifest: GateManifest | NetworkGateManifest): BatchMember[] {
  if (manifest.version === 1) return manifest.items.map(item => ({ key: item.key, command: gateItemCommand(manifest, item), summary: gateItemSummary(item) }))
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
  const network = [2, 3].includes((body.manifest as { version?: unknown } | null)?.version as number)
  const manifest = network ? parseNetworkGateManifest(body.manifest) : parseGateManifest(body.manifest)
  if (!network && body.operation === 'assertActive') throw new Error('Unsupported legacy gate operation')
  if (manifest.podId !== input.scope.podId) throw new Error('Gate batch belongs to another Pod')
  const members = gateMembers(manifest)
  const selected = body.operation === 'create' ? [] : parseGrants(body.grants, members)
  const check = async () => {
    await input.check()
    if (manifest.version !== 1) {
      if (!input.checkGate) throw new Error('Network approval requires a current runtime gate context')
      await input.checkGate(manifest, body.operation as string, selected.map(item => item.grant))
    }
  }
  if (manifest.version !== 1) await check()
  const connection = manifest.version !== 1 ? await input.connections.podConnection(input.scope.podId, manifest.owner, true) : await input.connections.podConnection(input.scope.podId)
  if (manifest.version !== 1) await check()
  // Network approve routes accept the owner's once or always decision; legacy workflow gates keep once grants until they leave (issue 1455, M4).
  const authority = createGrantAuthority(connection, input.signal, check, gateAudience, manifest.version !== 1 ? ['once', 'always'] : ['once'])
  if (body.operation === 'create') {
    const reply = await authority.createBatch({ id: manifest.id, title: manifest.title, expiresAt: manifest.expiresAt, reason: manifest.version !== 1 ? `${manifest.title}: approve this item` : `${manifest.title}: diesen Eintrag freigeben`, permissions: [`graph.gate:${manifest.id}`], members })
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
