import type { Client, InValue } from '@libsql/client'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const journals = new WeakMap<Client, string>()
const policyColumns = ['id', 'owner', 'series_id', 'team_id', 'audience', 'readers', 'access_revision', 'retention_revision', 'expires_at', 'removed_at', 'purged_at', 'latest_version', 'created_at', 'updated_at', 'legacy_plan_id']
const teamColumns = {
  teams: ['id', 'name', 'description', 'created_by', 'created_at', 'archived_at'],
  team_members: ['team_id', 'user_email', 'role', 'joined_at'],
  team_invites: ['id', 'team_id', 'created_by', 'note', 'max_uses', 'used_count', 'expires_at', 'revoked_at', 'created_at'],
}
type RecordRow = Record<string, InValue>
interface PolicyJournal { schema: 1, instance: string, revision: number, policies: RecordRow[], receipts: RecordRow[], teams: RecordRow[], team_members: RecordRow[], team_invites: RecordRow[], publishers: RecordRow[] }
async function capture(client: Client): Promise<PolicyJournal> {
  const state = (await client.execute('SELECT * FROM html_policy_state WHERE id=1')).rows[0]!
  const policies = (await client.execute(`SELECT ${policyColumns.join(',')} FROM html_documents ORDER BY id`)).rows
  const receipts = (await client.execute('SELECT identity,actor,key,digest,document_id FROM html_receipts ORDER BY identity,actor,key')).rows
  const result: PolicyJournal = { schema: 1, instance: String(state.instance_id), revision: Number(state.revision), policies, receipts, teams: [], team_members: [], team_invites: [], publishers: (await client.execute('SELECT id,owner,publisher,revision FROM report_series ORDER BY id')).rows }
  for (const table of ['teams', 'team_members', 'team_invites'] as const) result[table] = (await client.execute(`SELECT ${teamColumns[table].join(',')} FROM ${table}`)).rows
  return result
}
export async function writeHtmlPolicyJournal(client: Client) {
  const path = journals.get(client)
  if (!path) return
  const contents = JSON.stringify(await capture(client)); const temporary = `${path}.tmp-${randomUUID()}`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(contents); await file.sync() }
    finally { await file.close() }
    await rename(temporary, path)
    const directory = await open(dirname(path), 'r')
    try { await directory.sync() }
    finally { await directory.close() }
  }
  catch (error) {
    try { await unlink(temporary) }
    catch (cleanup) { if ((cleanup as NodeJS.ErrnoException).code !== 'ENOENT') throw new AggregateError([error, cleanup], 'Policy persistence and temporary-file cleanup failed') }
    throw error
  }
}
async function apply(client: Client, journal: PolicyJournal) {
  const tx = await client.transaction('write')
  try {
    const state = (await tx.execute('SELECT * FROM html_policy_state WHERE id=1')).rows[0]!
    if (journal.instance !== state.instance_id) throw new Error('Policy journal belongs to a different Reports database')
    if (journal.revision <= Number(state.revision)) { await tx.commit(); return }
    for (const policy of journal.policies) {
      const current = (await tx.execute({ sql: 'SELECT * FROM html_documents WHERE id=?', args: [policy.id!] })).rows[0]
      if (policy.purged_at === null && (!current || Number(current.latest_version) < Number(policy.latest_version))) throw new Error('Restored database lacks newer immutable versions; recover the newer content before serving Reports')
      if (current && current.owner !== policy.owner) throw new Error('Policy journal owner mismatch')
      if (!current) {
        await tx.execute({ sql: `INSERT INTO html_documents (${policyColumns.join(',')}) VALUES (${policyColumns.map(() => '?').join(',')})`, args: policyColumns.map(column => policy[column]!) })
      }
      else {
        const fields = policyColumns.filter(column => !['id', 'latest_version', 'created_at', 'updated_at'].includes(column))
        await tx.execute({ sql: `UPDATE html_documents SET ${fields.map(field => `${field}=?`).join(',')} WHERE id=?`, args: [...fields.map(field => policy[field]!), policy.id!] })
      }
      if (policy.purged_at !== null) {
        await tx.execute({ sql: 'DELETE FROM html_versions WHERE document_id=?', args: [policy.id!] })
        await tx.execute({ sql: 'UPDATE html_receipts SET receipt=? WHERE document_id=?', args: [JSON.stringify({ document_id: policy.id, purged: true }), policy.id!] })
      }
    }
    for (const publisher of journal.publishers) {
      const current = (await tx.execute({ sql: 'SELECT owner FROM report_series WHERE id=?', args: [publisher.id!] })).rows[0]
      if (!current || current.owner !== publisher.owner) throw new Error('Restored database lacks the current publisher series; recover the newer database before serving Reports')
      await tx.execute({ sql: 'UPDATE report_series SET publisher=?,revision=? WHERE id=?', args: [publisher.publisher!, publisher.revision!, publisher.id!] })
    }
    for (const receipt of journal.receipts) {
      const current = (await tx.execute({ sql: 'SELECT digest FROM html_receipts WHERE identity=? AND actor=? AND key=?', args: [receipt.identity!, receipt.actor!, receipt.key!] })).rows[0]
      if (current && current.digest !== receipt.digest) throw new Error('Policy journal receipt conflict')
      if (!current) await tx.execute({ sql: 'INSERT INTO html_receipts (identity,actor,key,digest,document_id,receipt) VALUES (?,?,?,?,?,?)', args: [receipt.identity!, receipt.actor!, receipt.key!, receipt.digest!, receipt.document_id!, JSON.stringify({ document_id: receipt.document_id, recovery_tombstone: true })] })
    }
    for (const table of ['team_invites', 'team_members', 'teams'] as const) await tx.execute(`DELETE FROM ${table}`)
    for (const table of ['teams', 'team_members', 'team_invites'] as const) {
      const fields = teamColumns[table]
      for (const record of journal[table]) await tx.execute({ sql: `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`, args: fields.map(field => record[field]!) })
    }
    await tx.execute({ sql: 'UPDATE html_policy_state SET revision=? WHERE id=1', args: [journal.revision] })
    await tx.commit()
  }
  catch (error) { await tx.rollback(); throw error }
  finally { tx.close() }
}
export async function initializeHtmlPolicyJournal(client: Client, path: string) {
  let saved: unknown
  try { saved = JSON.parse(await readFile(path, 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const count = (await client.execute('SELECT COUNT(*) AS count FROM html_documents')).rows[0]!
    if (Number(count.count)) throw new Error('Missing Reports policy journal: restore the current journal before serving an existing HTML database')
  }
  if (saved !== undefined) {
    const journal = saved as PolicyJournal
    if (!journal || journal.schema !== 1 || typeof journal.instance !== 'string' || !Number.isSafeInteger(journal.revision) || !['policies', 'receipts', 'teams', 'team_members', 'team_invites', 'publishers'].every(field => Array.isArray((journal as unknown as Record<string, unknown>)[field]))) throw new Error('Invalid Reports policy journal')
    await apply(client, journal)
  }
  journals.set(client, path)
  await writeHtmlPolicyJournal(client)
}
