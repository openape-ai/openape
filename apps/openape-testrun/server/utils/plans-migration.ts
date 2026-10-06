import type { Client, InValue } from '@libsql/client'
import { ReportError, invalid, object } from '../../shared/html-publication'
import { hash, insertVersion, row, transaction } from './html-store'
import { planPublication } from './plans-store'

const columns = {
  teams: ['id', 'name', 'description', 'created_by', 'created_at', 'archived_at'],
  team_members: ['team_id', 'user_email', 'role', 'joined_at'],
  team_invites: ['id', 'team_id', 'created_by', 'note', 'max_uses', 'used_count', 'expires_at', 'revoked_at', 'created_at'],
  plans: ['id', 'team_id', 'title', 'body_md', 'status', 'owner_email', 'created_at', 'updated_at', 'updated_by', 'deleted_at'],
} as const
type SnapshotRow = Record<string, InValue>
export interface PlansSnapshot { schema: 1, teams: SnapshotRow[], team_members: SnapshotRow[], team_invites: SnapshotRow[], plans: SnapshotRow[] }
const tables = Object.keys(columns) as (keyof typeof columns)[]
function canonical(snapshot: PlansSnapshot) {
  return JSON.stringify(tables.map(table => [table, snapshot[table].map(record => columns[table].map(column => record[column] ?? null)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]))
}
export const plansSnapshotDigest = (snapshot: PlansSnapshot) => hash(canonical(snapshot))
export async function capturePlans(client: Client): Promise<PlansSnapshot> {
  const tx = await client.transaction('read')
  try {
    const result: PlansSnapshot = { schema: 1, teams: [], team_members: [], team_invites: [], plans: [] }
    for (const table of tables) result[table] = (await tx.execute(`SELECT ${columns[table].join(',')} FROM ${table}`)).rows
    await tx.commit(); return result
  }
  finally { tx.close() }
}
export function validatePlansSnapshot(input: unknown): PlansSnapshot {
  const snapshot = object(input, ['schema', ...tables])
  if (snapshot.schema !== 1) invalid('Unknown Plans snapshot schema')
  for (const table of tables) {
    if (!Array.isArray(snapshot[table])) invalid(`Missing snapshot table ${table}`)
    const seen = new Set<string>()
    for (const entry of snapshot[table] as unknown[]) {
      const record = object(entry, [...columns[table]])
      if (!columns[table].every(column => column in record && (record[column] === null || typeof record[column] === 'string' || typeof record[column] === 'number'))) invalid(`Invalid ${table} row`)
      const key = table === 'team_members' ? `${record.team_id}\0${record.user_email}` : String(record.id)
      if (seen.has(key)) invalid(`Duplicate ${table} identity`)
      seen.add(key)
    }
  }
  const result = snapshot as unknown as PlansSnapshot
  const teamIds = new Set(result.teams.map(team => team.id))
  for (const record of [...result.team_members, ...result.team_invites, ...result.plans.filter(plan => plan.deleted_at === null)]) {
    if (!teamIds.has(record.team_id)) invalid('Orphaned legacy team reference; reconcile the source before import')
  }
  return result
}
export async function importPlans(client: Client, input: unknown, now = Date.now()) {
  const snapshot = validatePlansSnapshot(input); const digest = plansSnapshotDigest(snapshot)
  return transaction(client, async (tx) => {
    const previous = await row(tx, 'SELECT * FROM plans_migration WHERE id=1')
    if (previous) {
      if (previous.source_digest !== digest) throw new ReportError('CONFLICT', 'A different Plans snapshot was already imported; reconcile the writer before proceeding', 409)
      const missing = await row(tx, 'SELECT COUNT(*) AS count FROM plans_imports i LEFT JOIN html_documents d ON d.id=i.document_id WHERE d.id IS NULL')
      if (Number(missing?.count)) throw new ReportError('CONFLICT', 'Imported document identities are missing', 409)
      return { digest, imported: 0, replayed: true, plans: snapshot.plans.length }
    }
    for (const table of ['teams', 'team_members', 'team_invites'] as const) {
      for (const record of snapshot[table]) {
        const fields = columns[table]
        await tx.execute({ sql: `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`, args: fields.map(column => record[column] as InValue) })
      }
    }
    for (const plan of snapshot.plans) {
      const publication = planPublication(String(plan.title), String(plan.body_md), String(plan.status))
      await tx.execute({ sql: 'INSERT INTO html_documents (id,legacy_plan_id,owner,team_id,audience,created_at,updated_at,removed_at) VALUES (?,?,?,?,?,?,?,?)', args: [plan.id!, plan.id!, plan.owner_email!, plan.team_id!, 'team', Number(plan.created_at) * 1000, Number(plan.updated_at) * 1000, plan.deleted_at === null ? null : Number(plan.deleted_at) * 1000] })
      await insertVersion(tx, String(plan.id), 1, publication, String(plan.updated_by), Number(plan.updated_at) * 1000, String(plan.body_md))
      await tx.execute({ sql: 'INSERT INTO plans_imports (document_id,source_digest,artifact_digest) VALUES (?,?,?)', args: [plan.id!, hash(JSON.stringify(columns.plans.map(column => plan[column]))), hash(publication.html)] })
    }
    await tx.execute({ sql: 'INSERT INTO plans_migration (id,source_digest,imported_at,plan_count) VALUES (1,?,?,?)', args: [digest, now, snapshot.plans.length] })
    return { digest, imported: snapshot.plans.length, replayed: false, plans: snapshot.plans.length }
  })
}
export async function reconcilePlans(client: Client, input: unknown) {
  const snapshot = validatePlansSnapshot(input); const digest = plansSnapshotDigest(snapshot)
  const receipt = await row(client, 'SELECT * FROM plans_migration WHERE id=1')
  if (receipt?.source_digest !== digest) throw new ReportError('CONFLICT', 'Source snapshot does not match the migration receipt', 409)
  const differences: string[] = []; let purged = 0; let changed = 0
  for (const table of ['teams', 'team_members', 'team_invites'] as const) {
    for (const source of snapshot[table]) {
      const actual = table === 'team_members'
        ? await row(client, 'SELECT * FROM team_members WHERE team_id=? AND user_email=?', [source.team_id!, source.user_email!])
        : await row(client, `SELECT * FROM ${table} WHERE id=?`, [source.id!])
      if (!actual || columns[table].some(column => actual[column] !== source[column])) differences.push(`${table}: ${source.id ?? source.user_email}: metadata or permission drift`)
    }
  }
  if (Number(receipt.plan_count) !== snapshot.plans.length) differences.push('Migration count mismatch')
  for (const plan of snapshot.plans) {
    const document = await row(client, 'SELECT * FROM html_documents WHERE id=? OR legacy_plan_id=?', [plan.id!, plan.id!])
    const imported = await row(client, 'SELECT * FROM plans_imports WHERE document_id=?', [plan.id!])
    if (!document || !imported || imported.source_digest !== hash(JSON.stringify(columns.plans.map(column => plan[column])))) { differences.push(`${plan.id}: identity or source digest mismatch`); continue }
    if (document.id !== plan.id || document.owner !== plan.owner_email || Number(document.created_at) !== Number(plan.created_at) * 1000) differences.push(`${plan.id}: identity, ownership or creation mismatch`)
    if (document.purged_at !== null) { purged++; continue }
    if (document.legacy_plan_id !== plan.id) differences.push(`${plan.id}: legacy identity mismatch`)
    if (Number(document.access_revision) === 1 && (document.audience !== 'team' || document.team_id !== plan.team_id || document.readers !== '[]')) differences.push(`${plan.id}: imported access mismatch`)
    if (Number(document.retention_revision) === 1 && (document.expires_at !== null || document.removed_at !== (plan.deleted_at === null ? null : Number(plan.deleted_at) * 1000))) differences.push(`${plan.id}: imported retention mismatch`)
    const first = await row(client, 'SELECT * FROM html_versions WHERE document_id=? AND version=1', [document.id!])
    if (!first || first.source !== plan.body_md || first.artifact_digest !== imported.artifact_digest || hash(String(first.html)) !== imported.artifact_digest) differences.push(`${plan.id}: imported immutable version mismatch`)
    if (first && (first.title !== plan.title || first.author !== plan.updated_by || Number(first.created_at) !== Number(plan.updated_at) * 1000 || first.category !== 'Plans' || JSON.parse(String(first.metadata))['plans.status'] !== plan.status)) differences.push(`${plan.id}: imported metadata or attribution mismatch`)
    if (Number(document.latest_version) > 1) changed++
  }
  return { digest, plans: snapshot.plans.length, purged, changed, differences, reconciled: differences.length === 0 }
}
export async function rollbackPlansSnapshot(client: Client, now = Date.now()): Promise<PlansSnapshot> {
  const tx = await client.transaction('read')
  try {
    const result: PlansSnapshot = { schema: 1, teams: [], team_members: [], team_invites: [], plans: [] }
    for (const table of ['teams', 'team_members', 'team_invites'] as const) result[table] = (await tx.execute(`SELECT ${columns[table].join(',')} FROM ${table}`)).rows
    const documents = (await tx.execute('SELECT * FROM html_documents WHERE legacy_plan_id IS NOT NULL')).rows
    for (const document of documents) {
      if (document.purged_at !== null) continue
      const version = await row(tx, 'SELECT * FROM html_versions WHERE document_id=? AND version=?', [document.id!, document.latest_version!])
      const expired = document.expires_at !== null && Number(document.expires_at) <= now
      const deleted = document.removed_at !== null || expired
      if (!version || version.source === null || (!deleted && (document.audience !== 'team' || document.expires_at !== null))) throw new ReportError('CONFLICT', 'Rollback cannot represent an active HTML-only, non-team or finite-lifetime Plan; keep the writer frozen and reconcile explicitly', 409)
      const status = JSON.parse(String(version.metadata))['plans.status']
      if (!['draft', 'active', 'done', 'archived'].includes(status)) throw new ReportError('CONFLICT', 'Rollback cannot represent the current Plan status', 409)
      result.plans.push({ id: document.legacy_plan_id!, team_id: document.team_id!, title: version.title!, body_md: version.source!, status, owner_email: document.owner!, created_at: Math.floor(Number(document.created_at) / 1000), updated_at: Math.floor(Number(document.updated_at) / 1000), updated_by: version.author!, deleted_at: deleted ? Math.floor(Math.min(...[document.removed_at, expired ? document.expires_at : null].filter(item => item !== null).map(Number)) / 1000) : null })
    }
    await tx.commit(); return result
  }
  finally { tx.close() }
}
export async function applyPlansRollback(legacy: Client, expectedDigest: string, delta: PlansSnapshot) {
  const before = await capturePlans(legacy)
  if (plansSnapshotDigest(before) !== expectedDigest) throw new ReportError('CONFLICT', 'Legacy writer changed after the backup; rollback refused', 409)
  return transaction(legacy, async (tx) => {
    const current: PlansSnapshot = { schema: 1, teams: [], team_members: [], team_invites: [], plans: [] }
    for (const table of tables) current[table] = (await tx.execute(`SELECT ${columns[table].join(',')} FROM ${table}`)).rows
    if (plansSnapshotDigest(current) !== expectedDigest) throw new ReportError('CONFLICT', 'Concurrent legacy write during rollback', 409)
    for (const table of [...tables].reverse()) await tx.execute(`DELETE FROM ${table}`)
    for (const table of tables) {
      for (const record of delta[table]) await tx.execute({ sql: `INSERT INTO ${table} (${columns[table].join(',')}) VALUES (${columns[table].map(() => '?').join(',')})`, args: columns[table].map(column => record[column] as InValue) })
    }
    return { digest: plansSnapshotDigest(delta), plans: delta.plans.length }
  }, { policyJournal: false })
}
