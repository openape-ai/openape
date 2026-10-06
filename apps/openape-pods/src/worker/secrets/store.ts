import type { SecretRequestRow } from '../../contracts/secrets'
import { parseSecretRequestRow } from '../../contracts/secrets'
import type { PodDatabase } from '../storage/database'

export type SecretRowCommand = { type: 'list' } | { type: 'record', row: SecretRequestRow } | { type: 'update', id: string, patch: Partial<Pick<SecretRequestRow, 'status' | 'error' | 'updatedAt'>> }

/** The local rows of secret requests: what was asked for which Pod, and how far it got. Never a value. */
export class SecretRequests {
  constructor(private readonly store: PodDatabase) {}

  list(podId?: string): SecretRequestRow[] {
    return this.store.db.prepare('SELECT * FROM secret_requests WHERE (?=\'\' OR pod_id=?) ORDER BY created_at DESC LIMIT 200').all(podId ?? '', podId ?? '').map(row => ({ id: String(row.id), podId: String(row.pod_id), alias: String(row.alias), purpose: String(row.purpose), status: row.status as SecretRequestRow['status'], expiresAt: Number(row.expires_at), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), error: row.error as string | null }))
  }

  execute(command: SecretRowCommand): SecretRequestRow[] {
    if (command.type === 'record') {
      const row = parseSecretRequestRow(command.row)
      this.store.getPod(row.podId)
      this.store.db.prepare('INSERT INTO secret_requests(id,pod_id,alias,purpose,status,expires_at,created_at,updated_at,error) VALUES(?,?,?,?,?,?,?,?,?)').run(row.id, row.podId, row.alias, row.purpose, row.status, row.expiresAt, row.createdAt, row.updatedAt, row.error)
    }
    if (command.type === 'update') {
      const current = this.list().find(row => row.id === command.id)
      if (!current) throw new Error('Secret request not found')
      const next = parseSecretRequestRow({ ...current, ...command.patch })
      this.store.db.prepare('UPDATE secret_requests SET status=?,error=?,updated_at=? WHERE id=?').run(next.status, next.error, next.updatedAt, next.id)
    }
    return this.list()
  }
}
