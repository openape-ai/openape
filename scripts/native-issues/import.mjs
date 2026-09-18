import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { digest } from './export.mjs'
import { makeManifest, readJson } from './manifest.mjs'

export function loadBundle(directory) {
  const root = realpathSync(directory)
  const manifest = readJson(join(root, 'manifest.json'))
  const expected = makeManifest(readJson(join(root, 'snapshot.json')), readJson(join(root, 'mapping.json')), readJson(join(root, 'history.json')))
  if (digest(expected) !== digest(manifest)) throw new Error('Manifest does not reconcile with its source snapshot and mapping')
  for (const asset of manifest.assets) {
    const path = join(root, 'assets', asset.sha256)
    if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error('Asset must be a regular file inside the bundle')
    const bytes = readFileSync(path)
    if (bytes.length !== asset.size || digest(bytes) !== asset.sha256) throw new Error(`Asset integrity mismatch: ${asset.id}`)
  }
  return { root, manifest, hash: digest(manifest) }
}

const tables = { issues: 'issues', comments: 'issue_comments', labels: 'issue_labels', labelLinks: 'issue_label_links', assets: 'issue_attachments' }
function insert(db, table, row) {
  const columns = Object.keys(row)
  db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row))
}
function ordered(rows) { return rows.map(row => JSON.stringify(row)).sort() }
function project(row, shape) { return Object.fromEntries(Object.keys(shape).map(key => [key, row[key]])) }

export function validateTarget(db, manifest, assetsDirectory) {
  const mismatches = []
  const target = db.prepare('SELECT * FROM issue_import_targets WHERE repo_id=?').get(manifest.destination.id)
  const batch = db.prepare('SELECT * FROM issue_import_batches WHERE id=?').get(manifest.batchId)
  if (!target || target.batch_id !== manifest.batchId || !batch || batch.manifest_hash !== digest(manifest)) mismatches.push('batch identity')
  for (const [name, table] of Object.entries(tables)) {
    const expected = manifest[name]
    const rows = ['issues', 'labels'].includes(name)
      ? db.prepare(`SELECT * FROM ${table} WHERE repo_id=?`).all(manifest.destination.id)
      : db.prepare(`SELECT t.* FROM ${table} t JOIN issues i ON i.id=t.issue_id WHERE i.repo_id=?`).all(manifest.destination.id)
    if (rows.length !== expected.length || JSON.stringify(ordered(rows.map(row => project(row, expected[0] ?? {})))) !== JSON.stringify(ordered(expected))) mismatches.push(name)
  }
  const origins = db.prepare('SELECT * FROM issue_import_origins WHERE batch_id=? ORDER BY source_key').all(manifest.batchId)
  if (JSON.stringify(ordered(origins.map(({ batch_id: _batch, ...row }) => ({ sourceKey: row.source_key, kind: row.kind, entityId: row.entity_id, contentHash: row.content_hash, provenance: row.provenance })))) !== JSON.stringify(ordered(manifest.origins))) mismatches.push('provenance')
  const aliases = db.prepare('SELECT l.* FROM issue_legacy_references l JOIN issues i ON i.id=l.issue_id WHERE i.repo_id=?').all(manifest.destination.id)
  if (JSON.stringify(ordered(aliases)) !== JSON.stringify(ordered(manifest.aliases))) mismatches.push('legacy references')
  const nativeAliases = db.prepare('SELECT * FROM issue_aliases WHERE repo_id=?').all(manifest.destination.id)
  if (JSON.stringify(ordered(nativeAliases)) !== JSON.stringify(ordered(manifest.issues.map(issue => ({ repo_id: issue.repo_id, number: issue.number, issue_id: issue.id }))))) mismatches.push('native aliases')
  const events = db.prepare('SELECT * FROM issue_events WHERE import_batch_id=?').all(manifest.batchId)
  if (JSON.stringify(ordered(events)) !== JSON.stringify(ordered(manifest.events.map(event => ({ ...event, import_batch_id: manifest.batchId }))))) mismatches.push('events')
  if (db.prepare('SELECT next_number FROM issue_counters WHERE repo_id=?').get(manifest.destination.id)?.next_number !== manifest.highWater + 1) mismatches.push('number reservation')
  for (const asset of manifest.assets) {
    const path = join(assetsDirectory, asset.storage_key)
    if (!existsSync(path) || !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) { mismatches.push(`asset:${asset.id}`); continue }
    const bytes = readFileSync(path)
    if (bytes.length !== asset.size || digest(bytes) !== asset.sha256) mismatches.push(`asset:${asset.id}`)
  }
  return { ok: mismatches.length === 0, mismatches, issues: manifest.issues.length, comments: manifest.comments.length, attachments: manifest.assets.length }
}

function approvalFor(bundle, database, assetsDirectory, approval, production) {
  if (!isAbsolute(database) || !isAbsolute(assetsDirectory) || realpathSync(database) !== database) throw new Error('Use explicit canonical absolute database and asset paths')
  if (approval.manifestHash !== bundle.hash || approval.database !== database || approval.assetsDirectory !== assetsDirectory || approval.destinationId !== bundle.manifest.destination.id || !approval.approvedBy || !approval.approvedAt) throw new Error('Approval must name this exact manifest, database, asset directory and destination')
  if (approval.scope !== (production ? 'production' : 'isolated')) throw new Error('Approval scope mismatch')
  if (production && approval.productionCutoverApproved !== true) throw new Error('Separate production cutover approval is required')
  if (bundle.manifest.exceptions.some(item => item.blocking || !item.disposition)) throw new Error('Manifest has blocking or undisposed exceptions')
}

function assertUnchanged(db, target) {
  if (target.status !== 'locked') throw new Error('Native writes were enabled; delta import and removal are forbidden')
  const origins = db.prepare('SELECT * FROM issue_import_origins WHERE batch_id=?').all(target.batch_id)
  for (const origin of origins) {
    const table = { issue: 'issues', comment: 'issue_comments', label: 'issue_labels' }[origin.kind]
    if (!table) throw new Error('Unknown imported entity kind')
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(origin.entity_id)
    if (!row || digest(row) !== origin.content_hash) throw new Error(`Imported entity changed outside its batch: ${origin.entity_id}`)
  }
  const ids = origins.filter(row => row.kind === 'issue').map(row => row.entity_id)
  const native = db.prepare('SELECT id FROM issues WHERE repo_id=?').all(target.repo_id)
  if (native.length !== ids.length || native.some(row => !ids.includes(row.id))) throw new Error('Destination contains native issues')
  if (db.prepare('SELECT 1 FROM issue_events e JOIN issues i ON i.id=e.issue_id WHERE i.repo_id=? AND (e.import_batch_id IS NULL OR e.import_batch_id != ?) LIMIT 1').get(target.repo_id, target.batch_id)) throw new Error('Destination contains native issue activity')
}

function removeRows(db, target) {
  db.prepare('DELETE FROM issue_import_targets WHERE repo_id=?').run(target.repo_id)
  for (const table of ['issue_label_links', 'issue_participants', 'issue_pull_links', 'issue_events', 'issue_attachments', 'issue_comments', 'issue_legacy_references', 'issue_aliases']) db.prepare(`DELETE FROM ${table} WHERE issue_id IN (SELECT id FROM issues WHERE repo_id=?)`).run(target.repo_id)
  db.prepare('DELETE FROM issues WHERE repo_id=?').run(target.repo_id)
  db.prepare('DELETE FROM issue_labels WHERE repo_id=?').run(target.repo_id)
  db.prepare('DELETE FROM issue_counters WHERE repo_id=?').run(target.repo_id)
  db.prepare('DELETE FROM issue_import_origins WHERE batch_id=?').run(target.batch_id)
}

export function applyBundle(bundle, { database, assetsDirectory, approval, production = false, beforeCommit }) {
  approvalFor(bundle, database, assetsDirectory, approval, production)
  const manifest = bundle.manifest
  mkdirSync(assetsDirectory, { recursive: true, mode: 0o700 })
  if (realpathSync(assetsDirectory) !== assetsDirectory) throw new Error('Asset directory must not be a symlink')
  for (const asset of manifest.assets) {
    const destination = join(assetsDirectory, asset.sha256)
    if (existsSync(destination)) {
      if (!lstatSync(destination).isFile() || realpathSync(destination) !== destination || digest(readFileSync(destination)) !== asset.sha256) throw new Error('Existing attachment does not match its content address')
    }
    else {
      copyFileSync(join(bundle.root, 'assets', asset.sha256), destination, 1)
    }
  }
  const archive = join(dirname(assetsDirectory), 'issue-imports', manifest.batchId, bundle.hash)
  mkdirSync(archive, { recursive: true, mode: 0o700 })
  if (realpathSync(archive) !== archive) throw new Error('Import archive must not use symlinks')
  for (const name of ['snapshot', 'manifest', 'mapping', 'history']) {
    const destination = join(archive, `${name}.json`)
    const source = join(bundle.root, `${name}.json`)
    if (existsSync(destination)) {
      if (!lstatSync(destination).isFile() || realpathSync(destination) !== destination || digest(readFileSync(destination)) !== digest(readFileSync(source))) throw new Error('Import archive integrity mismatch')
    }
    else {
      copyFileSync(source, destination, 1)
    }
  }
  const db = new DatabaseSync(database)
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE')
  try {
    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(manifest.destination.id)
    if (!repo || repo.owner !== manifest.destination.owner || repo.name !== manifest.destination.name || repo.reporting_enabled) throw new Error('Destination mismatch or reporting already enabled')
    const current = db.prepare('SELECT * FROM issue_import_targets WHERE repo_id=?').get(repo.id)
    if (current) {
      if (current.batch_id !== manifest.batchId) throw new Error('Destination belongs to another source batch; explicit remapping is required')
      assertUnchanged(db, current)
      removeRows(db, current)
    }
    else if (db.prepare('SELECT 1 FROM issues WHERE repo_id=?').get(repo.id) || db.prepare('SELECT 1 FROM issue_labels WHERE repo_id=?').get(repo.id)) {
      throw new Error('Destination must be empty; do not overwrite existing numbers or labels')
    }
    for (const issue of manifest.issues) {
      if (issue.assignee && issue.assignee !== repo.owner_email) throw new Error('This importer currently supports verified owner assignment only; review other eligibility before adding support')
    }
    db.prepare(`INSERT INTO issue_import_batches VALUES (?, ?, ?, ?, ?, 'staged') ON CONFLICT(id) DO UPDATE SET manifest_hash=excluded.manifest_hash, imported_by=excluded.imported_by, status='staged'`).run(manifest.batchId, `${manifest.source}/${manifest.repository}`, bundle.hash, manifest.operator, Date.now())
    for (const name of ['issues', 'comments', 'labels', 'labelLinks', 'assets']) {
      for (const row of manifest[name]) insert(db, tables[name], row)
    }
    for (const row of manifest.issues) insert(db, 'issue_aliases', { repo_id: row.repo_id, number: row.number, issue_id: row.id })
    for (const row of manifest.aliases) insert(db, 'issue_legacy_references', row)
    for (const event of manifest.events) insert(db, 'issue_events', { ...event, import_batch_id: manifest.batchId })
    for (const origin of manifest.origins) insert(db, 'issue_import_origins', { source_key: origin.sourceKey, batch_id: manifest.batchId, entity_id: origin.entityId, kind: origin.kind, content_hash: origin.contentHash, provenance: origin.provenance })
    insert(db, 'issue_counters', { repo_id: repo.id, next_number: manifest.highWater + 1 })
    insert(db, 'issue_import_targets', { repo_id: repo.id, batch_id: manifest.batchId, status: 'locked' })
    const result = validateTarget(db, manifest, assetsDirectory)
    if (!result.ok) throw new Error(`Reconciliation failed: ${result.mismatches.join(', ')}`)
    beforeCommit?.()
    db.exec('COMMIT')
    return { ...result, batchId: manifest.batchId, manifestHash: bundle.hash, writeFence: 'locked' }
  }
  catch (error) { db.exec('ROLLBACK'); throw error }
  finally { db.close() }
}

export function removeBatch(bundle, options) {
  approvalFor(bundle, options.database, options.assetsDirectory, options.approval, options.production ?? false)
  const db = new DatabaseSync(options.database)
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE')
  try {
    const target = db.prepare('SELECT * FROM issue_import_targets WHERE repo_id=?').get(bundle.manifest.destination.id)
    const batch = db.prepare('SELECT * FROM issue_import_batches WHERE id=?').get(bundle.manifest.batchId)
    if (!target || target.batch_id !== bundle.manifest.batchId || batch.manifest_hash !== bundle.hash) throw new Error('Batch does not match the approved removal')
    assertUnchanged(db, target); removeRows(db, target)
    db.prepare('UPDATE issue_import_batches SET status=\'removed\' WHERE id=?').run(bundle.manifest.batchId)
    db.exec('COMMIT')
    return { ok: true, removedBatch: bundle.manifest.batchId, retainedImmutableAssets: true }
  }
  catch (error) { db.exec('ROLLBACK'); throw error }
  finally { db.close() }
}
