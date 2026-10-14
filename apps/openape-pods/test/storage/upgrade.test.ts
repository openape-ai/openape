// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { createBackup, restoreBackup } from '../../src/worker/data/backup'
import { DomainData } from '../../src/worker/data/domain'
import { digest, PodDatabase, schemaVersion } from '../../src/worker/storage/database'
import { StorageError } from '../../src/worker/storage/errors'
import { programIdentity } from '../../src/contracts/programs'
import type { ProgramAssignment } from '../../src/contracts/programs'
import { programRequest } from '../../src/main/programs/invoke'
import type { PodResource } from '../../src/contracts/resources'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
// The exact schema the October 2026 releases wrote (desktop 7fab4b84), as read from a real profile.
const schema47 = readFileSync(join(import.meta.dirname, 'fixtures/schema-47.sql'), 'utf8')
// The exact schema 49 of the releases with tags instead of groups (issue 1468, main 876ba63b).
const schema49 = readFileSync(join(import.meta.dirname, 'fixtures/schema-49.sql'), 'utf8')
// The exact schema 50 of the releases with program approvals (issue 1468, main 1dabba88).
const schema50 = readFileSync(join(import.meta.dirname, 'fixtures/schema-50.sql'), 'utf8')
// The exact schema 51 of the releases with registry-adapter program assignments (issue 1473 revision 3, main 5cedbaf6).
const schema51 = readFileSync(join(import.meta.dirname, 'fixtures/schema-51.sql'), 'utf8')
function directory(): string {
  const root = mkdtempSync(join(tmpdir(), 'pods-upgrade-')); roots.push(root); return root
}
function open(root: string): PodDatabase {
  const store = new PodDatabase(root); stores.push(store); return store
}
function objects(path: string): unknown[] {
  const database = new DatabaseSync(path, { readOnly: true })
  try { return database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all() }
  finally { database.close() }
}
function read<T>(root: string, sql: string): T {
  const database = new DatabaseSync(join(root, 'control.sqlite'), { readOnly: true })
  try { return database.prepare(sql).all() as T }
  finally { database.close() }
}

/** A schema-47 profile with one network: a member with history, an archive move, a checkpoint, tags and a denylist. */
function profile47(root: string, change = '', version = 47) {
  const ids = { member: randomUUID(), standalone: randomUUID(), group: randomUUID(), network: randomUUID(), run: randomUUID(), grant: randomUUID(), ownGrant: randomUUID() }
  const owner = { issuer: 'https://identity.example.invalid', subject: 'synthetic-owner' }
  // Rows of the retired tables are seeded without their full case history; the conversion archives them as they are.
  const database = new DatabaseSync(join(root, 'control.sqlite'), { enableForeignKeyConstraints: false })
  database.exec(schema47)
  const run = (sql: string, ...values: (string | number | null)[]) => database.prepare(sql).run(...values)
  database.exec('BEGIN')
  database.exec('INSERT INTO settings VALUES(1,1,2); INSERT INTO data_settings VALUES(1,10737418240,0,NULL); INSERT INTO onboarding VALUES(1,0,NULL); INSERT INTO pod_organization VALUES(1,1); INSERT INTO network_scheduler_state(id) VALUES(1);')
  run('INSERT INTO pods VALUES(?,\'Mail member\',1,\'active\',NULL,3)', ids.member)
  run('INSERT INTO pods VALUES(?,\'Standalone\',1,\'active\',NULL,1)', ids.standalone)
  run('INSERT INTO checkpoints VALUES(?,2,\'{"old":true}\')', ids.member)
  run('INSERT INTO pod_groups VALUES(?,\'Company\',0)', ids.group)
  run('INSERT INTO network_owners VALUES(?,?)', owner.issuer, owner.subject)
  run('INSERT INTO networks(id,owner_issuer,owner_subject,group_id,name,revision,restore_nonce,created_at) VALUES(?,?,?,?,\'Mail\',1,\'nonce\',1)', ids.network, owner.issuer, owner.subject, ids.group)
  run('INSERT INTO network_revisions VALUES(?,1,\'{}\',?,1)', ids.network, digest('{}'))
  run('INSERT INTO network_members VALUES(?,?,NULL)', ids.network, ids.member)
  run('INSERT INTO network_checkpoints VALUES(?,?,4,\'{"lastDeliveredDate":"2026-10-12"}\')', ids.network, ids.member)
  run('INSERT INTO runs VALUES(?,?,?,\'completed\',1,2,\'archived one message\',NULL,2,1)', ids.run, ids.member, digest('script'))
  run('INSERT INTO network_invocations VALUES(?,?,1,?,\'boot\',\'nonce\',1,\'claim\',1,\'completed\',\'{}\',NULL,\'script\')', ids.run, ids.network, ids.member)
  run('INSERT INTO network_effect_attempts VALUES(?,1,?,\'case\',1,?,?,\'confirmed_applied\',1,?)', digest('move'), ids.run, digest('input'), digest('manifest'), ids.network)
  run('INSERT INTO network_effect_receipts VALUES(?,1,1,\'intent\',\'{"mailbox":"owner@example.invalid","messageId":"m1"}\',1)', digest('move'))
  run('INSERT INTO network_effect_receipts VALUES(?,1,2,\'confirmed_applied\',\'{"afterId":"m2"}\',2)', digest('move'))
  run('INSERT INTO item_tags VALUES(?,\'["mail"]\',1,1)', ids.network)
  run('INSERT INTO item_tags VALUES(?,\'["delta-mind"]\',2,1)', ids.member)
  run('INSERT INTO pod_sandbox_deny VALUES(?,?,1,\'["~/.ssh"]\')', ids.member, `network:${ids.network}`)
  run('INSERT INTO pod_sandbox VALUES(?,?,1,\'owner\')', ids.member, `network:${ids.network}`)
  run('INSERT INTO pod_grants VALUES(?,?,?,?,\'pods-mail\',\'[]\',\'archive\',\'always\',\'revoked\',?,1,0,1,1)', ids.grant, ids.member, owner.issuer, owner.subject, ids.network)
  run('INSERT INTO pod_grants VALUES(?,?,?,?,\'pod-runtime\',\'[]\',\'run\',\'always\',\'approved\',NULL,NULL,1,1,1)', ids.ownGrant, ids.standalone, owner.issuer, owner.subject)
  database.exec(`${change}COMMIT; PRAGMA user_version=${version};`)
  database.close()
  return ids
}

// The exact schema 48 the October 2026 releases since issue 1465 wrote, with its owner groups.
const schema48 = readFileSync(join(import.meta.dirname, 'fixtures/schema-48.sql'), 'utf8')

/** A schema-48 profile whose groups meet own tags, the tag limit and a name without letters. */
function profile48(root: string) {
  const ids = { tagged: randomUUID(), full: randomUUID(), plain: randomUUID(), symbols: randomUUID(), alone: randomUUID(), company: randomUUID(), mail: randomUUID(), odd: randomUUID() }
  const database = new DatabaseSync(join(root, 'control.sqlite'), { enableForeignKeyConstraints: false })
  database.exec(schema48)
  const run = (sql: string, ...values: (string | number | null)[]) => database.prepare(sql).run(...values)
  database.exec('BEGIN')
  database.exec('INSERT INTO settings VALUES(1,1,2); INSERT INTO data_settings VALUES(1,10737418240,0,NULL); INSERT INTO onboarding VALUES(1,0,NULL); INSERT INTO pod_organization VALUES(1,7); INSERT INTO data_sequence VALUES(1,0);')
  for (const [id, name] of [[ids.tagged, 'Invoices'], [ids.full, 'Busy'], [ids.plain, 'Plain'], [ids.symbols, 'Symbols'], [ids.alone, 'Alone']] as const) run('INSERT INTO pods VALUES(?,?,1,\'active\',NULL,1)', id, name)
  run('INSERT INTO pod_groups VALUES(?,\'Delta Mind GmbH\',0)', ids.company)
  run('INSERT INTO pod_groups VALUES(?,\'Mail\',1)', ids.mail)
  run('INSERT INTO pod_groups VALUES(?,\'★ ★\',0)', ids.odd)
  for (const [pod, group] of [[ids.tagged, ids.company], [ids.full, ids.company], [ids.plain, ids.mail], [ids.symbols, ids.odd]] as const) run('INSERT INTO pod_memberships VALUES(?,?)', pod, group)
  run('INSERT INTO item_tags VALUES(?,\'["finance"]\',3,1)', ids.tagged)
  run('INSERT INTO item_tags VALUES(?,?,1,1)', ids.full, JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']))
  database.exec('COMMIT; PRAGMA user_version=48;')
  database.close()
  return ids
}

it('turns the groups of a schema-48 profile into tags after a verified backup', () => {
  const fresh = directory(); open(fresh).close(); stores.pop()
  const root = directory(); const ids = profile48(root)
  const store = open(root)
  expect(readdirSync(root).filter(file => file.startsWith('before-v48-'))).toHaveLength(1)
  const tags = Object.fromEntries((store.db.prepare('SELECT id,tags,revision FROM item_tags').all()).map(row => [row.id, [JSON.parse(String(row.tags)), row.revision]]))
  expect(tags).toEqual({
    [ids.tagged]: [['finance', 'delta-mind-gmbh'], 4],
    [ids.full]: [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 1],
    [ids.plain]: [['mail'], 1],
  })
  // Nothing of the groups is lost: every row stays as history, the receipt names what could not become a tag.
  expect(store.db.prepare('SELECT source,count(*) AS rows FROM legacy_records GROUP BY source ORDER BY source').all()).toEqual([
    { source: 'pod_groups', rows: 3 }, { source: 'pod_memberships', rows: 4 }, { source: 'pod_organization', rows: 1 },
  ])
  const receipt = JSON.parse(String(store.db.prepare('SELECT body FROM storage_receipts WHERE kind=\'conversion\' AND json_extract(body,\'$.from\')=48').get()!.body)) as { from: number, tags: Record<string, number>, skipped: unknown[] }
  expect(receipt).toMatchObject({ from: 48, tags: { 'delta-mind-gmbh': 1, 'mail': 1 } })
  expect(receipt.skipped).toEqual([{ podId: ids.full, group: 'Delta Mind GmbH', reason: 'tag-limit' }, { podId: ids.symbols, group: '★ ★', reason: 'no-tag' }])
  store.close(); stores.pop()
  expect(objects(join(root, 'control.sqlite'))).toEqual(objects(join(fresh, 'control.sqlite')))
})

it('refuses a schema-48 database with a foreign object and changes nothing', () => {
  const root = directory(); profile48(root)
  const database = new DatabaseSync(join(root, 'control.sqlite')); database.exec('CREATE VIEW v AS SELECT 1;'); database.close()
  expect(() => open(root)).toThrow('schema 48')
  expect(readdirSync(root).filter(file => file.startsWith('before-v48-'))).toEqual([])
  expect(read(root, 'SELECT user_version, (SELECT count(*) FROM pod_memberships) AS members FROM pragma_user_version')).toEqual([{ user_version: 48, members: 4 }])
})

it('creates a fresh profile whose schema equals a converted schema-47 profile', () => {
  const fresh = directory(); open(fresh).close(); stores.pop()
  const converted = directory(); profile47(converted); open(converted).close(); stores.pop()
  expect(objects(join(converted, 'control.sqlite'))).toEqual(objects(join(fresh, 'control.sqlite')))
})

it('converts a schema-46 profile through the tag table of schema 47', () => {
  const fresh = directory(); open(fresh).close(); stores.pop()
  const root = directory(); profile47(root, 'DELETE FROM item_tags; DROP TABLE item_tags;', 46)
  const store = open(root)
  expect(store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(schemaVersion)
  expect(readdirSync(root).filter(file => file.startsWith('before-v46-'))).toHaveLength(1)
  store.close(); stores.pop()
  expect(objects(join(root, 'control.sqlite'))).toEqual(objects(join(fresh, 'control.sqlite')))
})

it.each([
  [48, () => schema48, 'INSERT INTO pod_organization VALUES(1,1);'],
  [49, () => schema49, ''],
])('lets a schema-%i profile hold program approvals through schema 50 and keeps its approvals unchanged (issue 1468)', (version, schema, rows) => {
  const fresh = directory(); open(fresh).close(); stores.pop()
  const root = directory(); const ids = { pod: randomUUID(), batch: randomUUID(), approval: randomUUID() }
  const database = new DatabaseSync(join(root, 'control.sqlite'))
  database.exec(schema())
  database.exec(`INSERT INTO settings VALUES(1,1,2); INSERT INTO data_settings VALUES(1,10737418240,0,NULL); INSERT INTO onboarding VALUES(1,0,NULL); ${rows} INSERT INTO data_sequence VALUES(1,0);`)
  database.prepare('INSERT INTO pods VALUES(?,\'Newsletter\',1,\'active\',NULL,1)').run(ids.pod)
  database.prepare('INSERT INTO approval_batches(id,pod_id,title,expires_at,next_poll_at,created_at) VALUES(?,?,\'Archive newsletters\',2,1,1)').run(ids.batch, ids.pod)
  database.prepare('INSERT INTO action_approvals VALUES(?,?,\'mail.archive\',\'owner@example.invalid:m1\',\'{}\',?,\'Weekly news\',\'{}\',?,\'grant-1\',\'approved\',NULL,NULL,1,1)').run(ids.approval, ids.pod, 'a'.repeat(64), ids.batch)
  expect(() => database.prepare('INSERT INTO action_approvals VALUES(?,?,\'program.run\',\'git push\',\'{}\',?,\'Push\',\'{}\',NULL,NULL,\'collecting\',NULL,NULL,1,1)').run(randomUUID(), ids.pod, 'b'.repeat(64))).toThrow('CHECK')
  database.exec(`PRAGMA user_version=${version}`); database.close()
  const store = open(root)
  expect(store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(schemaVersion)
  expect(readdirSync(root).filter(file => file.startsWith(`before-v${version}-`))).toHaveLength(1)
  expect(store.db.prepare('SELECT id,action,state,grant_id FROM action_approvals').all()).toEqual([{ id: ids.approval, action: 'mail.archive', state: 'approved', grant_id: 'grant-1' }])
  store.db.prepare('INSERT INTO action_approvals(id,pod_id,action,object,payload,payload_hash,title,authority,state,created_at,updated_at) VALUES(?,?,\'program.run\',\'git push\',\'{}\',?,\'Push\',\'{}\',\'collecting\',1,1)').run(randomUUID(), ids.pod, 'b'.repeat(64))
  expect(JSON.parse(String(store.db.prepare('SELECT body FROM storage_receipts WHERE kind=\'conversion\' AND json_extract(body,\'$.from\')=49').get()!.body))).toMatchObject({ from: 49, rebuilt: ['action_approvals'], rows: 1 })
  store.close(); stores.pop()
  // The upgraded schema is exactly the fresh one.
  expect(objects(join(root, 'control.sqlite'))).toEqual(objects(join(fresh, 'control.sqlite')))
})

// Issue 1473: titles composed by older desktops become summary titles; nothing the owner read is lost.
it('converts schema-50 approvals to summaries, keeping a long composed title as description', () => {
  const fresh = directory(); open(fresh).close(); stores.pop()
  const root = directory(); const ids = { pod: randomUUID(), batch: randomUUID(), short: randomUUID(), long: randomUUID() }
  const composed = `Rebase feature/x onto development (Pod) · Push to remote: git push --force-with-lease=feature/x:${'a'.repeat(40)} origin ${'a'.repeat(40)}:refs/heads/feature/x`
  const database = new DatabaseSync(join(root, 'control.sqlite'))
  database.exec(schema50)
  database.exec('INSERT INTO settings VALUES(1,1,2); INSERT INTO data_settings VALUES(1,10737418240,0,NULL); INSERT INTO onboarding VALUES(1,0,NULL); INSERT INTO data_sequence VALUES(1,0);')
  database.prepare('INSERT INTO pods VALUES(?,\'Rebase\',1,\'active\',NULL,1)').run(ids.pod)
  database.prepare('INSERT INTO approval_batches(id,pod_id,title,expires_at,next_poll_at,created_at) VALUES(?,?,\'Run program commands\',2,1,1)').run(ids.batch, ids.pod)
  database.prepare('INSERT INTO action_approvals VALUES(?,?,\'mail.archive\',\'owner@example.invalid:m1\',\'{}\',?,\'Weekly news · news@example.invalid\',\'{}\',NULL,NULL,\'collecting\',NULL,NULL,1,1)').run(ids.short, ids.pod, 'a'.repeat(64))
  database.prepare('INSERT INTO action_approvals VALUES(?,?,\'program.run\',\'git push\',\'{}\',?,?,\'{}\',?,\'grant-1\',\'requested\',NULL,NULL,1,1)').run(ids.long, ids.pod, 'b'.repeat(64), composed, ids.batch)
  database.exec('PRAGMA user_version=50'); database.close()
  const store = open(root)
  expect(store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(schemaVersion)
  expect(readdirSync(root).filter(file => file.startsWith('before-v50-'))).toHaveLength(1)
  expect(store.db.prepare('SELECT id,title,description,link,state,grant_id FROM action_approvals ORDER BY rowid').all()).toEqual([
    { id: ids.short, title: 'Weekly news · news@example.invalid', description: null, link: null, state: 'collecting', grant_id: null },
    { id: ids.long, title: `${composed.slice(0, 119)}…`, description: composed, link: null, state: 'requested', grant_id: 'grant-1' },
  ])
  expect(JSON.parse(String(store.db.prepare('SELECT body FROM storage_receipts WHERE kind=\'conversion\' AND json_extract(body,\'$.from\')=50').get()!.body))).toMatchObject({ from: 50, rebuilt: ['action_approvals'], rows: 2, shortened: 1 })
  expect(() => store.db.prepare('UPDATE action_approvals SET title=? WHERE id=?').run('t'.repeat(121), ids.short)).toThrow('CHECK')
  store.close(); stores.pop()
  expect(objects(join(root, 'control.sqlite'))).toEqual(objects(join(fresh, 'control.sqlite')))
})

// Issue 1473, revision 4: programs are assigned by path and file hash; adapter fields leave without owner action.
it('removes the adapter fields of schema-51 program assignments, keeps everything else and the programs callable', () => {
  const fresh = directory(); open(fresh).close(); stores.pop()
  const root = directory(); const ids = { pod: randomUUID(), registry: randomUUID(), local: randomUUID(), http: randomUUID(), grant: 'grant-approved' }
  const database = new DatabaseSync(join(root, 'control.sqlite'))
  database.exec(schema51)
  database.exec('INSERT INTO settings VALUES(1,1,2); INSERT INTO data_settings VALUES(1,10737418240,0,NULL); INSERT INTO onboarding VALUES(1,0,NULL); INSERT INTO data_sequence VALUES(1,0);')
  database.prepare('INSERT INTO pods VALUES(?,\'Mail\',1,\'active\',NULL,1)').run(ids.pod)
  const kept = { executableHash: 'a'.repeat(64), entryFiles: [], environment: { PROFILE: 'work' }, networkHosts: ['graph.microsoft.com'], stateId: randomUUID() }
  // Assigned with a shapes-registry adapter (revision 3) and, before it, with a local adapter whose command name differs from the file name.
  const registry = { type: 'program', name: 'gh', cliId: 'gh', executable: '/opt/homebrew/Cellar/gh/2.80.0/bin/gh', ...kept, adapterPath: '/profile/registry-adapters/gh-1.toml', adapterHash: 'b'.repeat(64), registry: { id: 'gh', digest: `SHA-256:${'b'.repeat(64)}` }, cliVersion: { version: '2.80.0', tested: true }, capability: `tool.app_${ids.registry.replaceAll('-', '')}.invoke` }
  const local = { type: 'program', name: 'Mail CLI', cliId: 'pods-mail', executable: '/opt/tools/o365', ...kept, runtime: { executable: '/usr/bin/env', executableHash: 'c'.repeat(64), arguments: [], readDirectories: [], environment: {}, descriptor: { path: '/opt/tools/runtime.json', hash: 'd'.repeat(64) } }, adapterPath: '/Users/owner/adapters/pods-mail.toml', adapterHash: 'e'.repeat(64), commands: [{ id: 'read' }], capability: `tool.app_${ids.local.replaceAll('-', '')}.invoke` }
  const http = { type: 'http', origin: 'https://api.example.invalid', methods: ['GET'], capability: 'tool.http_fixture.request' }
  for (const [id, name, configuration] of [[ids.registry, 'gh', registry], [ids.local, 'Mail CLI', local], [ids.http, 'API', http]] as const) database.prepare('INSERT INTO resources VALUES(?,?,1,\'tool\',\'ready\',?,?)').run(id, ids.pod, name, JSON.stringify(configuration))
  database.prepare('INSERT INTO pod_grants(id,pod_id,issuer,subject,cli_id,details,display,grant_type,state,approved_in_session,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,0,1,1)').run(ids.grant, ids.pod, 'https://id.example.invalid', 'pod@pods.example.invalid', 'gh', JSON.stringify([{ type: 'openape_cli', cli_id: 'gh', operation_id: '*', resource_chain: [{ resource: 'repo' }], action: 'read', permission: 'gh.repo[]#read', display: 'Every read', risk: 'low' }]), 'Every read', 'always', 'approved')
  database.exec('PRAGMA user_version=51'); database.close()
  const store = open(root)
  expect(store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(schemaVersion)
  expect(readdirSync(root).filter(file => file.startsWith('before-v51-'))).toHaveLength(1)
  const configuration = (id: string) => JSON.parse(String(store.db.prepare('SELECT configuration FROM resources WHERE id=?').get(id)!.configuration)) as Record<string, unknown>
  const { adapterPath: _registryPath, adapterHash: _registryHash, registry: _registry, cliVersion: _version, ...registryKept } = registry
  const { adapterPath: _localPath, adapterHash: _localHash, commands: _commands, ...localKept } = local
  expect(configuration(ids.registry)).toEqual(registryKept)
  expect(configuration(ids.local)).toEqual(localKept)
  expect(configuration(ids.http)).toEqual(http)
  // Both programs stay callable: each names the program the IdP receives, by its former command name and file hash.
  const resources = store.db.prepare('SELECT id,pod_id AS podId,revision,kind,state,name,configuration FROM resources').all().map(row => ({ ...row, configuration: JSON.parse(String(row.configuration)) })) as unknown as PodResource[]
  for (const [application, capability, name] of [['gh', registry.capability, 'gh'], ['Mail CLI', local.capability, 'pods-mail']] as const) {
    const { assignment } = programRequest(resources, ids.pod, [capability], { application, argv: ['read'] })
    expect(programIdentity(assignment as ProgramAssignment)).toEqual({ name, sha256: kept.executableHash })
  }
  // The grant ledger is untouched; program calls no longer look into it, so it causes no new request.
  expect(store.db.prepare('SELECT id,state FROM pod_grants').all()).toEqual([{ id: ids.grant, state: 'approved' }])
  expect(JSON.parse(String(store.db.prepare('SELECT body FROM storage_receipts WHERE kind=\'conversion\' AND json_extract(body,\'$.from\')=51').get()!.body))).toMatchObject({ from: 51, programs: 2, converted: 2 })
  store.close(); stores.pop()
  expect(objects(join(root, 'control.sqlite'))).toEqual(objects(join(fresh, 'control.sqlite')))
})

it('converts the network runtime into standalone Pods, keeping history, effects, state and restrictions', () => {
  const root = directory(); const ids = profile47(root)
  const store = open(root)
  expect(readdirSync(root).filter(file => file.startsWith('before-v47-'))).toHaveLength(1)
  expect(store.listPods().map(pod => [pod.name, pod.lifecycle])).toEqual([['Mail member', 'active'], ['Standalone', 'active']])
  expect(store.db.prepare('SELECT summary FROM runs WHERE id=?').get(ids.run)).toEqual({ summary: 'archived one message' })
  // Every retired row is archived unchanged and counted; nothing of the network runtime remains executable.
  expect(store.db.prepare('SELECT source,count(*) AS rows FROM legacy_records WHERE source IN (\'networks\',\'network_members\',\'network_invocations\',\'pod_grants\',\'pod_sandbox_deny\',\'item_tags\') GROUP BY source ORDER BY source').all()).toEqual([
    { source: 'item_tags', rows: 1 }, { source: 'network_invocations', rows: 1 }, { source: 'network_members', rows: 1 }, { source: 'networks', rows: 1 }, { source: 'pod_grants', rows: 1 }, { source: 'pod_sandbox_deny', rows: 1 },
  ])
  expect(store.db.prepare('SELECT name FROM sqlite_schema WHERE name LIKE \'network%\'').all()).toEqual([])
  // The archive move keeps its identity and receipts, so the message is never moved again.
  expect(store.db.prepare('SELECT action_key,pod_id,operation,state FROM effect_attempts').all()).toEqual([{ action_key: digest('move'), pod_id: ids.member, operation: 'mail.archive', state: 'confirmed_applied' }])
  expect(store.db.prepare('SELECT outcome FROM effect_receipts ORDER BY sequence').all()).toEqual([{ outcome: 'intent' }, { outcome: 'confirmed_applied' }])
  // The member continues from its network checkpoint.
  expect(store.db.prepare('SELECT revision,body FROM checkpoints WHERE pod_id=?').get(ids.member)).toEqual({ revision: 3, body: '{"lastDeliveredDate":"2026-10-12"}' })
  expect(store.db.prepare('SELECT json_extract(body,\'$.body\') AS body FROM legacy_records WHERE source=\'checkpoints\'').all()).toEqual([{ body: '{"old":true}' }])
  // The network's owner level gave the member owner reach; it keeps that level as its own.
  expect(store.db.prepare('SELECT level FROM pod_sandbox WHERE pod_id=?').all(ids.member)).toEqual([{ level: 'owner' }])
  // Inherited tags become own tags; the network's denylist keeps restricting the former member.
  expect(store.db.prepare('SELECT tags FROM item_tags WHERE id=?').get(ids.member)).toEqual({ tags: '["delta-mind","mail"]' })
  expect(store.db.prepare('SELECT paths FROM pod_sandbox_deny WHERE pod_id=?').get(ids.member)).toEqual({ paths: '["~/.ssh"]' })
  // Grants of the network are archived; the Pod's own grants stay.
  expect(store.db.prepare('SELECT id FROM pod_grants').all()).toEqual([{ id: ids.ownGrant }])
  // Members keep their mail-derived runs out of the central workspace.
  expect(store.db.prepare('SELECT pod_id FROM local_only_pods').all()).toEqual([{ pod_id: ids.member }])
  const receipt = JSON.parse(String(store.db.prepare('SELECT body FROM storage_receipts WHERE kind=\'conversion\' AND json_extract(body,\'$.from\')=47').get()!.body)) as { from: number, effects: number, archived: Record<string, { rows: number }> }
  expect(receipt).toMatchObject({ from: 47, effects: 1, archived: { networks: { rows: 1 } } })
  // Shared data works right after the conversion.
  const data = new DomainData(store)
  data.define({ path: 'synthetic/records', writer: 'owner', mode: 'records' })
  expect(data.set('owner', 'synthetic/records/one', { kept: true }, 0)).toEqual({ revision: 1 })
})

it.each([
  ['an open network delivery', 'INSERT INTO network_deliveries(id,network_id,event_id,subscription_id,case_id,case_revision,state,ready_at,accepted_at) VALUES(\'d\',\'n\',\'e\',\'s\',\'c\',1,\'pending\',1,1);', 'open network deliveries'],
  ['an archive move with an unknown outcome', 'UPDATE network_effect_attempts SET state=\'unknown\';', 'archive moves with an unknown outcome'],
  ['an undecided owner choice', 'INSERT INTO network_choices VALUES(\'n\',1,\'e\',\'g\',NULL,NULL,NULL);', 'undecided owner choices'],
  ['a scheduled retry of a failed invocation', 'INSERT INTO network_invocation_controls(run_id,retry_at) SELECT run_id,1 FROM network_invocations;', 'scheduled retries'],
])('refuses the conversion while the network runtime holds %s and changes nothing', (_name, change, reason) => {
  const root = directory(); profile47(root, change)
  let failure: unknown
  try { open(root) }
  catch (error) { failure = error }
  expect(failure).toBeInstanceOf(StorageError)
  expect(failure).toMatchObject({ reason: 'conversion-blocked', message: expect.stringContaining(reason) })
  expect(read(root, 'SELECT user_version, (SELECT count(*) FROM networks) AS networks FROM pragma_user_version')).toEqual([{ user_version: 47, networks: 1 }])
})

it('refuses a schema-47 database with any foreign object before executing a statement', () => {
  for (const crafted of ['CREATE TABLE "x""; DROP TABLE pods; --"(a);', 'CREATE TRIGGER t AFTER INSERT ON runs BEGIN DELETE FROM pods; END;', 'CREATE VIEW v AS SELECT 1;']) {
    const root = directory(); profile47(root, crafted)
    expect(() => open(root)).toThrow('schema 47')
    expect(readdirSync(root).filter(file => file.startsWith('before-v47-'))).toEqual([])
    expect(read(root, 'SELECT user_version, (SELECT count(*) FROM pods) AS pods FROM pragma_user_version')).toEqual([{ user_version: 47, pods: 2 }])
  }
})

it('refuses a profile older than schema 46 without changing its bytes', () => {
  const root = directory(); const database = new DatabaseSync(join(root, 'control.sqlite'))
  database.exec('CREATE TABLE pods(id TEXT PRIMARY KEY); PRAGMA user_version=45;'); database.close()
  const before = readFileSync(join(root, 'control.sqlite'))
  expect(() => open(root)).toThrow('created by an older OpenApe Pods version')
  expect(readFileSync(join(root, 'control.sqlite'))).toEqual(before)
  expect(readdirSync(root)).toEqual(['control.sqlite'])
})

it('restores a schema-47 backup as the current schema with every Pod paused and refuses an older one', async () => {
  const exports = directory(); const source = directory()
  const backup = await createBackup(open(source), exports)
  const legacy = directory(); const ids = profile47(legacy)
  const bytes = readFileSync(join(legacy, 'control.sqlite'))
  writeFileSync(join(backup, 'control.sqlite'), bytes)
  mkdirSync(join(backup, 'blobs'), { recursive: true })
  const manifest = JSON.parse(readFileSync(join(backup, 'backup.json'), 'utf8'))
  manifest.schema = 47
  manifest.files = manifest.files.map((file: { path: string }) => file.path === 'control.sqlite' ? { path: file.path, size: bytes.length, hash: digest(bytes) } : file)
  writeFileSync(join(backup, 'backup.json'), JSON.stringify(manifest))
  const restored = open(await restoreBackup(backup, exports, schemaVersion))
  expect(restored.db.prepare('PRAGMA user_version').get()!.user_version).toBe(schemaVersion)
  expect(restored.getPod(ids.member).lifecycle).toBe('paused')
  expect(restored.db.prepare('SELECT count(*) AS rows FROM legacy_records WHERE source=\'networks\'').get()).toEqual({ rows: 1 })
  writeFileSync(join(backup, 'backup.json'), JSON.stringify({ ...manifest, schema: 45 }))
  await expect(restoreBackup(backup, exports, schemaVersion)).rejects.toThrow('created by an older OpenApe Pods version')
})
