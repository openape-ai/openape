import type { AgentConnection } from '../../broker/authorization'
import { createGrantAuthority } from '../../gates/authority'
import type { GrantBinding } from '../../gates/authority'
import { archiveItemCommand, archiveItemSummary } from '../../../contracts/mail-archive'
import type { ArchiveManifest, ArchiveRecord } from '../../../contracts/mail-archive'
import type { ArchiveAuthority } from './service'

function binding(manifest: ArchiveManifest, record: Pick<ArchiveRecord, 'grants'>, id: string): GrantBinding & { key: string } {
  const item = manifest.items.find(entry => entry.id === id)
  const grant = record.grants?.find(entry => entry.id === id)
  if (!item || !grant) throw new Error('Archive message has no approval grant')
  return { key: id, grantId: grant.grantId, expiresAt: manifest.expiresAt, command: archiveItemCommand(manifest, item), summary: archiveItemSummary(item) }
}
export function createArchiveAuthority(connection: AgentConnection, signal: AbortSignal, check: () => Promise<unknown>): ArchiveAuthority {
  const authority = createGrantAuthority(connection, signal, check, 'pods-mail-archive')
  return {
    async create(manifest) {
      const reply = await authority.createBatch({ id: manifest.id, title: `${manifest.items.length} E-Mails aus ${manifest.mailbox} archivieren`, expiresAt: manifest.expiresAt, reason: `E-Mail aus ${manifest.mailbox} archivieren`, permissions: [`mail.archive:${manifest.id}`], members: manifest.items.map(item => ({ key: item.id, command: archiveItemCommand(manifest, item), summary: archiveItemSummary(item) })) })
      return { id: manifest.id, url: reply.url, grants: reply.grants.map(grant => ({ id: grant.key, grantId: grant.id })) }
    },
    statuses: record => authority.statuses(record.manifest.id, record.manifest.items.map(item => binding(record.manifest, record, item.id))),
    consume: (record, id) => authority.consume(binding(record.manifest, record, id)),
    assertActive: (record, id) => authority.assertActive(binding(record.manifest, record, id)),
  }
}
