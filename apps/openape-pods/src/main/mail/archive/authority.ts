import { computeCmdHash } from '@openape/core'
import type { OpenApeGrant } from '@openape/core'
import { sameBrokeredGrant, verifyAuthzJWT } from '@openape/grants'
import { AgentAuthority } from '../../broker/authorization'
import type { AgentConnection } from '../../broker/authorization'
import { connectionRequest, readJSON } from '../../connections/http'
import { archiveCommand, archiveSummary } from '../../../contracts/mail-archive'
import type { ArchiveRecord } from '../../../contracts/mail-archive'
import type { ArchiveAuthority } from './service'

const audience = 'pods-mail-archive'
export function createArchiveAuthority(connection: AgentConnection, signal: AbortSignal, check: () => Promise<unknown>): ArchiveAuthority {
  const decisionIssuer = connection.decisionIssuer ?? connection.issuer
  async function get(record: ArchiveRecord): Promise<OpenApeGrant> {
    await check(); signal.throwIfAborted()
    if (!record.grantId || !/^[\w-]{1,128}$/.test(record.grantId)) throw new Error('Missing archive grant identity')
    const grant = await readJSON(await fetch(`${connection.issuer}/api/grants/${record.grantId}`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${await connection.accessToken()}` } })) as unknown as OpenApeGrant
    const request = grant.request
    if (grant.id !== record.grantId || request?.requester !== connection.subject || request.audience !== audience || request.target_host !== connection.targetHost || request.grant_type !== 'once' || request.waits_until !== Math.floor(record.manifest.expiresAt / 1000) || JSON.stringify(request.command) !== JSON.stringify(archiveCommand(record.manifest)) || request.summary?.text !== archiveSummary(record.manifest) || !sameBrokeredGrant(grant.brokered, connection.brokered)) throw new Error('Archive grant differs from the reviewed batch or Pod identity')
    return grant
  }
  function manual(grant: OpenApeGrant): void {
    if (grant.decided_by !== connection.owner || grant.auto_approval_kind || grant.decided_by_standing_grant) throw new Error('Archiving requires a manual owner decision on this exact batch')
  }
  return {
    async create(manifest) {
      await check(); signal.throwIfAborted()
      const reply = await connectionRequest(connection.issuer, '/api/grants', { requester: connection.subject, target_host: connection.targetHost, audience, grant_type: 'once', command: archiveCommand(manifest), permissions: [`mail.archive:${manifest.id}`], waits_until: Math.floor(manifest.expiresAt / 1000), reason: `${manifest.items.length} E-Mails aus ${manifest.mailbox} archivieren`, summary: { text: archiveSummary(manifest) } }, signal, await connection.accessToken())
      if (typeof reply.id !== 'string' || !/^[\w-]{1,128}$/.test(reply.id)) throw new Error('Invalid archive grant response')
      return { id: reply.id, url: `${decisionIssuer}/grant-approval?grant_id=${encodeURIComponent(reply.id)}` }
    },
    async status(record) {
      const grant = await get(record)
      if (grant.status === 'pending') return 'pending'
      if (grant.status === 'expired') return 'expired'
      if (grant.status === 'denied' || grant.status === 'revoked') return 'denied'
      if (grant.status !== 'approved') throw new Error('Archive grant was already used outside this execution')
      manual(grant)
      return 'approved'
    },
    async consume(record) {
      const grant = await get(record); manual(grant)
      if (grant.status !== 'approved' || record.manifest.expiresAt <= Date.now()) throw new Error('Archive approval is not current')
      const response = await connectionRequest(connection.issuer, `/api/grants/${record.grantId}/token`, {}, signal, await connection.accessToken())
      if (typeof response.authz_jwt !== 'string') throw new Error('Missing archive authorization token')
      const token = response.authz_jwt
      const verification = await verifyAuthzJWT(token, { expectedIss: decisionIssuer, expectedAud: audience, jwksUri: `${decisionIssuer}/.well-known/jwks.json` })
      const claims = verification.claims
      if (!verification.valid || !claims || claims.sub !== connection.subject || claims.target_host !== connection.targetHost || claims.grant_id !== record.grantId || claims.grant_type !== 'once' || claims.decided_by !== connection.owner || claims.cmd_hash !== await computeCmdHash(archiveCommand(record.manifest).join(' ')) || JSON.stringify(claims.command) !== JSON.stringify(archiveCommand(record.manifest)) || !sameBrokeredGrant(claims.brokered, connection.brokered)) throw new Error('Archive token does not authorize this exact batch')
      await check(); signal.throwIfAborted()
      const consumed = await connectionRequest(decisionIssuer, `/api/grants/${record.grantId}/consume`, {}, signal, token)
      if (consumed.status !== 'consumed' || consumed.error) throw new Error('Archive grant was not consumed; no message may move')
    },
    async assertActive(record) {
      const grant = await get(record); manual(grant)
      await new AgentAuthority(connection).assertActive(record.grantId!, signal)
      if (grant.status !== 'used' || record.manifest.expiresAt <= Date.now()) throw new Error('Consumed archive authority is no longer valid')
      await check(); signal.throwIfAborted()
    },
  }
}
