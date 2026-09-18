import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { test } from 'node:test'
import { DatabaseSync, backup } from 'node:sqlite'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { databaseMigrations } from '../apps/openape-git/server/database/migrations.ts'
import { digest } from './native-issues/export.mjs'
import { makeManifest, references } from './native-issues/manifest.mjs'
import { applyBundle, loadBundle, removeBatch, validateTarget } from './native-issues/import.mjs'

const source = 'https://forgejo.example.test'
const repository = 'team/project'
const time = '2026-01-01T00:00:00Z'
const issue = (number, body = 'Original `$HOME`\n\n#7 and `#7`') => ({ id: number, number, title: `Issue ${number}`, body, state: 'open', created_at: time, updated_at: time, user: { id: -1, login: 'Ghost' }, assignees: [], labels: [{ id: 1 }], comments: [{ id: number * 10, body: 'Original comment', user: { id: 2, login: 'former-user' }, created_at: time, updated_at: time }], timeline: [{ id: number * 100, type: 'close', user: { login: 'source-owner' }, created_at: time }], assets: [], commentAssets: [] })
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'issue-import-'))); t.after(() => rmSync(root, { recursive: true, force: true }))
  const database = join(root, 'registry.db'); const assetsDirectory = join(root, 'issue-assets')
  const db = new DatabaseSync(database); db.exec('PRAGMA foreign_keys=ON')
  for (const migration of databaseMigrations) {
    for (const statement of migration.statements) db.exec(statement)
  }
  db.prepare('INSERT INTO repos(id,owner,name,owner_email,created_at) VALUES(?,?,?,?,?)').run('repo', 'owner', 'project', 'owner@example.test', 1)
  db.prepare('INSERT INTO pulls(id,repo_id,number,title,source_ref,target_ref,author_email,created_at) VALUES(?,?,?,?,?,?,?,?)').run('existing-pr', 'repo', 7, 'Existing PR', 'a', 'main', 'owner@example.test', 1)
  db.close()
  function bundle(records = [issue(2), issue(7)], settings = {}) {
    const snapshot = { format: 1, source, repository, snapshot: { repository: { private: true }, issues: records, pulls: [{ number: 10 }], labels: [{ id: 1, name: 'bug', color: 'ff0000', description: 'Existing label' }] }, assets: settings.assets ?? [] }
    const history = { source, repository, rows: [{ id: 3, content_text: 'Prior revision', is_deleted: 0 }] }
    const mapping = { snapshotHash: digest(snapshot), destination: { id: 'repo', owner: 'owner', name: 'project' }, operator: 'isolated-test', exceptions: {}, ...settings.mapping }
    const preliminary = makeManifest(snapshot, mapping, history)
    for (const item of preliminary.exceptions) {
      if (!item.blocking) mapping.exceptions[item.id] = 'Synthetic rehearsal disposition'
    }
    const manifest = makeManifest(snapshot, mapping, history)
    const directory = join(root, `bundle-${digest(manifest)}`); mkdirSync(directory, { recursive: true }); mkdirSync(join(directory, 'assets'), { recursive: true })
    for (const [name, value] of Object.entries({ snapshot, history, mapping, manifest })) writeFileSync(join(directory, `${name}.json`), JSON.stringify(value))
    for (const asset of snapshot.assets) writeFileSync(join(directory, 'assets', asset.sha256), settings.bytes ?? Buffer.alloc(0))
    return loadBundle(directory)
  }
  function options(bundle) { return { database, assetsDirectory, approval: { manifestHash: bundle.hash, database, assetsDirectory, destinationId: 'repo', approvedBy: 'synthetic-test', approvedAt: time, scope: 'isolated' } } }
  return { root, database, assetsDirectory, bundle, options }
}

test('imports sparse numbers, provenance and ordered comments atomically; repeats and applies a deletion/edit delta', (t) => {
  const f = fixture(t); const first = f.bundle()
  assert.equal(applyBundle(first, f.options(first)).ok, true)
  assert.equal(applyBundle(first, f.options(first)).ok, true)
  const db = new DatabaseSync(f.database)
  assert.deepEqual(db.prepare('SELECT number, author_subject FROM issues ORDER BY number').all().map(row => [row.number, row.author_subject]), [[2, null], [7, null]])
  assert.equal(db.prepare('SELECT next_number FROM issue_counters').get().next_number, 11)
  assert.equal(db.prepare('SELECT count(*) AS total FROM issue_participants').get().total, 0)
  assert.throws(() => db.prepare('UPDATE issues SET title=\'native edit\'').run(), /ISSUE_IMPORT_LOCKED/)
  assert.throws(() => db.prepare('UPDATE issue_comments SET body=\'native edit\'').run(), /ISSUE_IMPORT_LOCKED/)
  db.prepare('UPDATE pulls SET title=\'Git PR remains writable\'').run(); db.close()
  const delta = f.bundle([issue(7, 'Edited source')])
  assert.throws(() => applyBundle(delta, { ...f.options(delta), beforeCommit() { throw new Error('Interrupted') } }), /Interrupted/)
  const interrupted = new DatabaseSync(f.database); assert.equal(validateTarget(interrupted, first.manifest, f.assetsDirectory).ok, true); interrupted.close()
  assert.equal(applyBundle(delta, f.options(delta)).ok, true)
  const after = new DatabaseSync(f.database); assert.equal(after.prepare('SELECT count(*) AS total FROM issues').get().total, 1); assert.equal(after.prepare('SELECT body FROM issues').get().body, 'Edited source'); assert.equal(after.prepare('SELECT title FROM pulls').get().title, 'Git PR remains writable'); after.close()
  assert.equal(removeBatch(delta, f.options(delta)).ok, true)
  const removed = new DatabaseSync(f.database); assert.equal(removed.prepare('SELECT count(*) AS total FROM issues').get().total, 0); assert.equal(removed.prepare('SELECT count(*) AS total FROM pulls').get().total, 1); removed.close()
})

test('blocks collisions, locked sources, unverified identities and writes after native activation', (t) => {
  const f = fixture(t)
  assert.throws(() => f.bundle([issue(2), issue(7)], { mapping: { numbers: { 7: 2 } } }), /Duplicate destination/)
  assert.throws(() => f.bundle([issue(2)], { mapping: { identities: { '-1': { subject: 'owner@example.test' } } } }), /independently reviewed/)
  const locked = f.bundle([{ ...issue(2), is_locked: true }]); assert.throws(() => applyBundle(locked, f.options(locked)), /blocking/)
  const bundle = f.bundle(); applyBundle(bundle, f.options(bundle))
  const db = new DatabaseSync(f.database); db.exec('UPDATE issue_import_targets SET status=\'released\''); db.close()
  assert.throws(() => applyBundle(bundle, f.options(bundle)), /Native writes were enabled/)
  assert.throws(() => removeBatch(bundle, f.options(bundle)), /Native writes were enabled/)
})

test('binds approval to exact source, target and manifest; rejects mutated archive bytes', (t) => {
  const f = fixture(t); const bundle = f.bundle(); const options = f.options(bundle)
  assert.throws(() => applyBundle(bundle, { ...options, approval: { ...options.approval, manifestHash: 'other' } }), /Approval must name/)
  assert.throws(() => applyBundle(bundle, { ...options, production: true }), /scope mismatch/)
  const mappingPath = join(bundle.root, 'mapping.json'); const originalMapping = readFileSync(mappingPath)
  const mapping = JSON.parse(originalMapping); mapping.identities = { unused: { subject: 'other@example.test', verifiedBy: 'changed', proof: 'changed' } }
  writeFileSync(mappingPath, JSON.stringify(mapping))
  assert.throws(() => loadBundle(bundle.root), /does not reconcile/)
  writeFileSync(mappingPath, originalMapping)
  const manifest = JSON.parse(readFileSync(join(bundle.root, 'manifest.json'))); manifest.issues[0].title = 'Tampered'
  writeFileSync(join(bundle.root, 'manifest.json'), JSON.stringify(manifest))
  assert.throws(() => loadBundle(bundle.root), /does not reconcile/)
})

test('preserves zero-byte assets and restores DB, provenance, aliases and bytes without changing Git PRs', async (t) => {
  const f = fixture(t); const bytes = Buffer.alloc(0)
  const bundle = f.bundle([issue(2)], { bytes, assets: [{ id: 1, issueId: 2, name: 'empty.html', size: 0, sha256: digest(bytes), mimeType: 'text/html', browser_download_url: `${source}/attachments/00000000-0000-0000-0000-000000000001` }] })
  applyBundle(bundle, f.options(bundle))
  const db = new DatabaseSync(f.database); const destination = join(f.root, 'restored.db'); await backup(db, destination); db.close()
  const restoredAssets = join(f.root, 'restored-assets'); cpSync(f.assetsDirectory, restoredAssets, { recursive: true })
  const restored = new DatabaseSync(destination); assert.equal(validateTarget(restored, bundle.manifest, restoredAssets).ok, true); restored.close()
  const proof = JSON.parse(execFileSync('python3', ['apps/openape-git/ops/verify-issue-backup.py', destination, restoredAssets], { encoding: 'utf8' }))
  assert.equal(proof.attachments, 1); assert.equal(proof.ok, true)
  const mappingPath = join(f.root, 'issue-imports', bundle.manifest.batchId, bundle.hash, 'mapping.json')
  const mapping = JSON.parse(readFileSync(mappingPath)); mapping.operator = 'changed'
  writeFileSync(mappingPath, JSON.stringify(mapping))
  assert.throws(() => execFileSync('python3', ['apps/openape-git/ops/verify-issue-backup.py', destination, restoredAssets], { stdio: 'pipe' }), /Command failed/)
  writeFileSync(join(restoredAssets, digest(bytes)), 'changed')
  const damaged = new DatabaseSync(destination); assert.equal(validateTarget(damaged, bundle.manifest, restoredAssets).ok, false); damaged.close()
})

test('classifies references outside fenced/inline code without confusing source PRs and issues', () => {
  const result = references('See #2, #10 and team/other#8. `#99`\n\n```js\n#100\n```\n[Old](https://forgejo.example.test/team/project/issues/2)', source, repository, new Set([2]), new Set([10]))
  assert.equal(result.find(item => item.text === '#2').kind, 'issue')
  assert.equal(result.find(item => item.text === '#10').kind, 'pull')
  assert.equal(result.some(item => ['#99', '#100'].includes(item.text)), false)
  assert.equal(result.find(item => item.text === 'team/other#8').kind, 'unresolved')
})

test('archive HTTP fence distinguishes issue/admin/blob mutations from Git, Actions and other repos', async () => {
  const { frozenIssueWrite } = await import('./native-issues/archive-proxy.mjs')
  const scope = { repository: 'team/project', attachments: ['known-asset'], actors: [{ id: 1, login: 'source-owner' }] }
  for (const path of ['/api/v1/repos/team/project/issues', '/api/v1/repos/team/project/issues/comments/1/assets/2', '/team/project/issues/1/title', '/team/project/settings', '/api/v1/repos/team/project/transfer', '/attachments/known-asset', '/api/v1/admin/users/source-owner', '/admin/users/1/delete']) assert.equal(frozenIssueWrite('DELETE', path, scope), true, path)
  assert.equal(frozenIssueWrite('POST', '/api/v1/repos/team%2fproject/issues', scope), true)
  for (const path of ['/team/project.git/git-receive-pack', '/api/v1/repos/team/project/statuses/sha', '/api/actions/runner.v1.RunnerService/FetchTask', '/api/v1/repos/team/other/issues', '/user/login']) assert.equal(frozenIssueWrite('POST', path, scope), false, path)
  assert.equal(frozenIssueWrite('GET', '/api/v1/repos/team/project/issues/1', scope), false)
})
