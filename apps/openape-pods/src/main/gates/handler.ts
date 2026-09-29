import { gateAudience, gateCommand, gateSummary, parseGateManifest } from '../../contracts/gates'
import type { ServiceScope } from '../../contracts/services'
import type { ConnectionManager } from '../connections/manager'
import { createGrantAuthority } from './authority'

interface Request { body: unknown, scope: ServiceScope, connections: ConnectionManager, check: () => Promise<unknown>, signal: AbortSignal }
/** Requests, reads and consumes the collective grant of one gate batch as the Pod that takes what the gate gives. */
export async function handleGate(input: Request): Promise<unknown> {
  const body = input.body as { operation?: unknown, manifest?: unknown, grantId?: unknown }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !['create', 'status', 'consume'].includes(body.operation as string) || Object.keys(body).some(key => !['operation', 'manifest', 'grantId'].includes(key))) throw new Error('Invalid gate operation')
  const manifest = parseGateManifest(body.manifest)
  if (manifest.podId !== input.scope.podId) throw new Error('Gate batch belongs to another Pod')
  const authority = createGrantAuthority(await input.connections.podConnection(input.scope.podId), input.signal, input.check, gateAudience)
  const binding = { expiresAt: manifest.expiresAt, command: gateCommand(manifest), summary: gateSummary(manifest) }
  if (body.operation === 'create') return authority.create({ ...binding, reason: `${manifest.title}: ${manifest.items.length} Einträge freigeben`, permissions: [`graph.gate:${manifest.id}`] })
  if (typeof body.grantId !== 'string') throw new Error('Missing approval grant identity')
  if (body.operation === 'status') return authority.status({ ...binding, grantId: body.grantId })
  await authority.consume({ ...binding, grantId: body.grantId })
  return true
}
