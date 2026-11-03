import type { Client, Transaction } from '@libsql/client'
import { createHash } from 'node:crypto'

const queries = [
  'SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE \'sqlite_%\' AND name!=\'reports_recovery_state\' ORDER BY name,type',
  'SELECT * FROM html_policy_state ORDER BY id',
  'SELECT * FROM html_documents ORDER BY id',
  'SELECT id,document_id,version,artifact_digest,policy_version FROM html_versions ORDER BY id',
  'SELECT identity,actor,key,digest,document_id FROM html_receipts ORDER BY identity,actor,key',
  'SELECT * FROM report_series ORDER BY id',
  'SELECT * FROM teams ORDER BY id',
  'SELECT * FROM team_members ORDER BY team_id,user_email',
  'SELECT * FROM team_invites ORDER BY id',
  'SELECT id,slug,visibility,created_by,deleted_at,version,report_type FROM runs ORDER BY id',
  'SELECT id,run_id,version,path,size FROM assets ORDER BY id',
  'SELECT id,run_id,version FROM run_versions ORDER BY id',
  'SELECT * FROM report_publications ORDER BY id',
  'SELECT id,series_id,version,owner,publisher,idempotency_key,digest,artifact_digest,policy_version FROM document_publications ORDER BY id',
]
export async function authorityFingerprint(db: Pick<Client, 'execute'> | Transaction) {
  const hash = createHash('sha256')
  for (const sql of queries) {
    const result = await db.execute(sql)
    hash.update(sql)
    hash.update(JSON.stringify(result.rows.map(row => result.columns.map(column => row[column]))))
  }
  return hash.digest('hex')
}
