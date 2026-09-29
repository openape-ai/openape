import type { AgentConnection } from '../../broker/authorization'
import { createGrantAuthority } from '../../gates/authority'
import type { GrantBinding } from '../../gates/authority'
import { archiveCommand, archiveSummary } from '../../../contracts/mail-archive'
import type { ArchiveRecord } from '../../../contracts/mail-archive'
import type { ArchiveAuthority } from './service'

const binding = (record: Pick<ArchiveRecord, 'manifest' | 'grantId'>): GrantBinding => ({ grantId: record.grantId, expiresAt: record.manifest.expiresAt, command: archiveCommand(record.manifest), summary: archiveSummary(record.manifest) })
export function createArchiveAuthority(connection: AgentConnection, signal: AbortSignal, check: () => Promise<unknown>): ArchiveAuthority {
  const authority = createGrantAuthority(connection, signal, check, 'pods-mail-archive')
  return {
    create: manifest => authority.create({ ...binding({ manifest }), reason: `${manifest.items.length} E-Mails aus ${manifest.mailbox} archivieren`, permissions: [`mail.archive:${manifest.id}`] }),
    status: record => authority.status(binding(record)),
    consume: record => authority.consume(binding(record)),
    assertActive: record => authority.assertActive(binding(record)),
  }
}
