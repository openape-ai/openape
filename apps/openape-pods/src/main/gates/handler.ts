import type { ServiceScope } from '../../contracts/services'
import type { ConnectionManager } from '../connections/manager'
import { connectionRequest } from '../connections/http'
import type { OwnerSession } from '../connections/owner-session'
import { createGrantAuthority } from './authority'
import type { BatchGrant, BatchMember } from './authority'
import { approvalAudience, approvalCommand, parseApprovalManifest } from '../../contracts/approvals'
import type { ApprovalManifest } from '../../contracts/approvals'

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

/**
 * A brokered Pod grant exists only at the owner's decision IdP, where only the owner may revoke it; the agent
 * provider does not forward a revoke (issue 1462).
 */
export function ownerRevoke(owner: () => Promise<OwnerSession | null>, signal: AbortSignal) {
  return async (grantId: string): Promise<Record<string, unknown>> => {
    const session = await owner()
    if (!session) throw new Error('Revoking a brokered Pod grant needs an active owner session (the MCP sign-in); otherwise the owner revokes it at the IdP')
    return connectionRequest(session.issuer, `/api/grants/${encodeURIComponent(grantId)}/revoke`, {}, signal, await session.bearer(signal))
  }
}

/** One member per object approval; the IdP command is the frozen item authority. */
export function approvalMembers(manifest: ApprovalManifest): BatchMember[] {
  return manifest.items.map(item => ({ key: item.key, command: approvalCommand(item.authority), summary: item.summary }))
}

interface ApprovalRequest { body: unknown, scope: ServiceScope, connections: ConnectionManager, check: () => Promise<unknown>, checkApproval: (manifest: ApprovalManifest, operation: string, grants: BatchGrant[]) => Promise<unknown>, signal: AbortSignal }

/** Requests, reads and uses the grants of object approvals (issue 1465) as the Pod that will act. */
export async function handleApproval(input: ApprovalRequest): Promise<unknown> {
  const body = input.body as { operation?: unknown, manifest?: unknown, grants?: unknown }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !['create', 'status', 'consume', 'assertActive'].includes(body.operation as string) || Object.keys(body).some(key => !['operation', 'manifest', 'grants'].includes(key))) throw new Error('Invalid approval operation')
  const manifest = parseApprovalManifest(body.manifest)
  if (manifest.podId !== input.scope.podId) throw new Error('Approval batch belongs to another Pod')
  const members = approvalMembers(manifest)
  const selected = body.operation === 'create' ? [] : parseGrants(body.grants, members)
  const check = async () => {
    await input.check()
    await input.checkApproval(manifest, body.operation as string, selected.map(item => item.grant))
  }
  await check()
  const connection = await input.connections.podConnection(input.scope.podId, manifest.owner, true)
  await check()
  const authority = createGrantAuthority(connection, input.signal, check, approvalAudience, ['once', 'always'])
  if (body.operation === 'create') return authority.createBatch({ id: manifest.batchId, open: true, title: manifest.title, expiresAt: manifest.expiresAt, permissions: [`pods.approval:${manifest.batchId}`], members })
  const bindings = selected.map(({ grant, member }) => ({ ...member, grantId: grant.id, expiresAt: manifest.expiresAt }))
  if (body.operation === 'status') return authority.statuses(manifest.batchId, bindings)
  for (const binding of bindings) {
    if (body.operation === 'assertActive') await authority.assertActive(binding)
    else await authority.consume(binding)
  }
  return true
}

/** Withdraws unanswered requests and revokes always-approved grants of finished approvals; it only reduces authority. */
export async function releaseApprovalGrants(release: { podId: string, manifest: ApprovalManifest, grants: BatchGrant[] }, connections: ConnectionManager, signal: AbortSignal, owner: () => Promise<OwnerSession | null> = async () => null): Promise<number> {
  const manifest = parseApprovalManifest(release.manifest)
  const connection = await connections.podConnection(release.podId, manifest.owner, true)
  const authority = createGrantAuthority(connection, signal, async () => {}, approvalAudience, ['once', 'always'])
  const members = approvalMembers(manifest)
  const bindings = parseGrants(release.grants, members).map(({ grant, member }) => ({ ...member, grantId: grant.id, expiresAt: manifest.expiresAt }))
  return authority.release(manifest.batchId, bindings, connection.brokered ? ownerRevoke(owner, signal) : undefined)
}
