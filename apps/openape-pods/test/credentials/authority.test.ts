import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase, digest } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { ScriptCredentials } from '../../src/worker/resources/script-credentials'
import { parseCredentialAlias, parseScriptCapabilities } from '../../src/contracts/credentials'
import { WorkspaceDetails } from '../../src/worker/workspace/details'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-secret-authority-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store)
  const pod = store.createPod({ name: 'One' }); const registry = new ResourceRegistry(store, () => {})
  return { store, pod, registry, authority: new ScriptCredentials(store, registry) }
}
function version(f: ReturnType<typeof fixture>, code = 'export async function run() {}') {
  const hash = digest(code); const revision = f.store.getPod(f.pod.id).bindingRevision
  f.store.storeScript(f.pod.id, { schemaVersion: 1, contentHash: hash, entrypoint: 'run.mjs', dependencyLockHash: 'a'.repeat(64), runtimeVersion: 'test', capabilities: ['credential.crm'], triggers: ['manual'], inputSchemaHash: 'b'.repeat(64), outputSchemaHash: 'c'.repeat(64), checkpointSchemaVersion: 1, assignmentRevision: revision, effects: 'readOnly' }, code)
  f.store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(f.pod.id, hash, revision, f.registry.epoch(f.pod.id), '{}')
  return hash
}
it('requires exact-source owner approval and invalidates it after credential rotation and rejects stale review metadata', () => {
  const f = fixture(); f.registry.assignCredential(f.pod.id, 'crm', randomUUID(), 0)
  const hash = version(f); const activate = () => new WorkspaceDetails(f.store, f.registry).execute({ type: 'activate', podId: f.pod.id, hash, expectedActive: null, assignmentRevision: 1 })
  expect(activate).toThrow('Approve credential access')
  f.authority.approve(f.pod.id, hash, 1, 1); expect(f.authority.approved(f.pod.id, hash)).toBe(true)
  activate(); expect(f.store.getPod(f.pod.id).activeScript).toBe(hash)
  f.store.updatePod(f.pod.id, 1, { name: 'Renamed', lifecycle: 'paused' }); expect(f.authority.approved(f.pod.id, hash)).toBe(true)
  const changed = version(f, 'export async function run() { return 1 }'); expect(f.authority.approved(f.pod.id, changed)).toBe(false)
  f.registry.assignCredential(f.pod.id, 'crm', randomUUID(), 1); expect(f.authority.approved(f.pod.id, hash)).toBe(false)
  expect(() => f.authority.approve(f.pod.id, hash, 1, 1)).toThrow()
  f.store.updatePod(f.pod.id, 2, { name: 'Changed', lifecycle: 'paused' }); expect(() => f.authority.approve(f.pod.id, hash, 1, 2)).toThrow()
})
it('keeps identical aliases separate across pods and rejects stale, missing or revoked assignments', () => {
  const f = fixture(); const other = f.store.createPod({ name: 'Two' }); const first = randomUUID(); const second = randomUUID()
  f.registry.assignCredential(f.pod.id, 'crm', first, 0); f.registry.assignCredential(other.id, 'crm', second, 0)
  expect(f.authority.assigned(f.pod.id, 'crm').configuration.credentialId).toBe(first); expect(f.authority.assigned(other.id, 'crm').configuration.credentialId).toBe(second)
  expect(() => f.registry.assignCredential(f.pod.id, 'crm', randomUUID(), 0)).toThrow()
  expect(() => f.authority.assigned(f.pod.id, 'missing')).toThrow()
  const resource = f.authority.assigned(f.pod.id, 'crm'); f.registry.revoke(f.pod.id, resource.id, resource.revision)
  expect(() => f.authority.assigned(f.pod.id, 'crm')).toThrow(); expect(f.authority.assigned(other.id, 'crm').state).toBe('ready')
})
it('validates aliases and an exact bounded capability set', () => {
  expect(parseScriptCapabilities(['tool.orders.read'])).toEqual(['tool.orders.read']); expect(parseCredentialAlias('crm_api')).toBe('crm_api'); expect(parseScriptCapabilities(['mail.read', 'credential.crm_api'])).toEqual(['mail.read', 'credential.crm_api'])
  for (const alias of ['../crm', 'CRM', '', 'a'.repeat(65)]) expect(() => parseCredentialAlias(alias)).toThrow()
  for (const capabilities of [['shell.exec'], ['credential.crm', 'credential.crm'], Array.from({ length: 17 }, (_, i) => `credential.a${i}`)]) expect(() => parseScriptCapabilities(capabilities)).toThrow()
})

it('authorizes only the declared alias under a current pinned run lease', async () => {
  const { RunStore } = await import('../../src/worker/runs/store')
  const { authorizeCredentialService, authorizeMailService } = await import('../../src/worker/mail/authorization')
  const f = fixture(); const key = randomUUID(); f.registry.assignCredential(f.pod.id, 'crm', key, 0)
  const hash = version(f); f.authority.approve(f.pod.id, hash, 1, 1)
  new WorkspaceDetails(f.store, f.registry).execute({ type: 'activate', podId: f.pod.id, hash, expectedActive: null, assignmentRevision: 1 })
  const runs = new RunStore(f.store); const run = runs.reserve(f.pod.id, hash, 1).run
  const scope = { podId: f.pod.id, runId: run.id, assignmentRevision: 1, epoch: 1, capabilities: ['credential.crm'] }
  const read = (changes = {}, alias = 'crm') => authorizeCredentialService(f.store, f.registry, runs, { scope: { ...scope, ...changes } }, alias)
  expect(read()).toBe(key)
  for (const changes of [{ podId: randomUUID() }, { runId: randomUUID() }, { epoch: 0 }, { assignmentRevision: 2 }, { capabilities: ['credential.other'] }]) expect(() => read(changes)).toThrow()
  expect(() => read({}, 'other')).toThrow('not declared')
  expect(() => authorizeMailService(f.store, f.registry, runs, { scope })).toThrow('capability')
  f.registry.assignCredential(f.pod.id, 'crm', randomUUID(), 1); expect(() => read()).toThrow()
  runs.finish(run.id, 'completed', 'Synthetic', null); expect(() => read()).toThrow('lease')
})

it('migrates schema 11 resources without losing assignments or their revisions', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const f = fixture(); const reference = f.registry.assignReference(f.pod.id, 'Notes', join(f.store.root, 'notes.txt'))
  const root = f.store.root; f.store.close(); stores.pop()
  const previous = new DatabaseSync(join(root, 'control.sqlite'))
  previous.exec(`ALTER TABLE pods DROP COLUMN metadata_revision; DROP TABLE pod_chat_origins; DROP TABLE master_creations; DROP TABLE pod_descriptions; DROP TABLE summary_domains; DROP TABLE program_leases; DROP TABLE master_message_scopes; DROP TABLE master_contexts; DROP TABLE pod_variables; DROP TABLE script_credential_approvals;
    ALTER TABLE resources RENAME TO newer_resources;
    CREATE TABLE resources(id TEXT PRIMARY KEY, pod_id TEXT NOT NULL REFERENCES pods(id), revision INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('reference','tool','connection')), state TEXT NOT NULL CHECK(state IN ('ready','missing','expired','revoked','refreshRequired')), name TEXT NOT NULL, configuration TEXT NOT NULL);
    INSERT INTO resources SELECT * FROM newer_resources; DROP TABLE newer_resources; PRAGMA user_version=11;`)
  previous.close()
  const migrated = new PodDatabase(root); stores.push(migrated); const registry = new ResourceRegistry(migrated, () => {})
  expect(registry.list(f.pod.id)).toEqual([reference]); expect(registry.epoch(f.pod.id)).toBe(1)
  registry.assignCredential(f.pod.id, 'crm', randomUUID(), 1)
  expect(registry.list(f.pod.id)[1]?.kind).toBe('credential')
  expect(migrated.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})
