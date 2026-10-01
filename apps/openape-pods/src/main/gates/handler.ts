import { networkGateCommand, networkGateSummary, parseNetworkGateManifest } from '../../contracts/network-gates'
import type { NetworkGateManifest } from '../../contracts/network-gates'
import { gateAudience, gateCommand, gateSummary, parseGateManifest } from '../../contracts/gates'
import type { ServiceScope } from '../../contracts/services'
import type { ConnectionManager } from '../connections/manager'
import { createGrantAuthority } from './authority'

interface Request { body: unknown, scope: ServiceScope, connections: ConnectionManager, check: () => Promise<unknown>, checkGate?: (manifest: NetworkGateManifest, operation: string, grantId?: string) => Promise<unknown>, signal: AbortSignal }
/** Requests, reads and consumes the collective grant of one gate batch as the Pod that takes what the gate gives. */
export async function handleGate(input: Request): Promise<unknown> {
  const body = input.body as { operation?: unknown, manifest?: unknown, grantId?: unknown }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !['create', 'status', 'consume', 'assertActive'].includes(body.operation as string) || Object.keys(body).some(key => !['operation', 'manifest', 'grantId'].includes(key))) throw new Error('Invalid gate operation')
  const network = (body.manifest as { version?: unknown } | null)?.version === 2
  const manifest = network ? parseNetworkGateManifest(body.manifest) : parseGateManifest(body.manifest)
  if (!network && body.operation === 'assertActive') throw new Error('Unsupported legacy gate operation')
  if (manifest.podId !== input.scope.podId) throw new Error('Gate batch belongs to another Pod')
  const check = async () => {
    await input.check()
    if (manifest.version === 2) {
      if (!input.checkGate) throw new Error('Network approval requires a current runtime gate context')
      await input.checkGate(manifest, body.operation as string, typeof body.grantId === 'string' ? body.grantId : undefined)
    }
  }
  if (manifest.version === 2) await check()
  const connection = manifest.version === 2 ? await input.connections.podConnection(input.scope.podId, manifest.owner, true) : await input.connections.podConnection(input.scope.podId)
  if (manifest.version === 2) await check()
  const authority = createGrantAuthority(connection, input.signal, check, gateAudience)
  const binding = { expiresAt: manifest.expiresAt, command: manifest.version === 2 ? networkGateCommand(manifest) : gateCommand(manifest), summary: manifest.version === 2 ? networkGateSummary(manifest) : gateSummary(manifest) }
  if (body.operation === 'create') return authority.create({ ...binding, reason: manifest.version === 2 ? `${manifest.title}: approve ${manifest.items.length} items` : `${manifest.title}: ${manifest.items.length} Einträge freigeben`, permissions: [`graph.gate:${manifest.id}`] })
  if (typeof body.grantId !== 'string') throw new Error('Missing approval grant identity')
  if (body.operation === 'status') return authority.status({ ...binding, grantId: body.grantId })
  if (body.operation === 'assertActive') { await authority.assertActive({ ...binding, grantId: body.grantId }); return true }
  await authority.consume({ ...binding, grantId: body.grantId })
  return true
}
