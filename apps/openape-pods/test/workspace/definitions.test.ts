import { createBackup, restoreBackup } from '../../src/worker/data/backup'
import { WorkspaceDetails } from '../../src/worker/workspace/details'
import { parseDefinitionsView } from '../../src/contracts/definitions'
import { DataRetention } from '../../src/worker/data/retention'
import { networkFixture, closeNetworks } from '../scheduling/network-fixture'
import { validateDraft } from '../../src/worker/master/validation'
import { executeScript } from '../../src/worker/runs/runner'
import type { AgentRuntime } from '../../src/worker/agent/executor'
// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase, schemaVersion } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { DefinitionWorkspace } from '../../src/worker/workspace/definitions'
import { installExample } from '../../src/worker/runs/examples'
import { podDirectories } from '../../src/runtime/environment'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
const stores: PodDatabase[] = []; const roots: string[] = []
afterEach(async () => { await closeNetworks(); vi.restoreAllMocks(); const opened = stores.splice(0); for (const store of opened) store.close(); for (const root of [...opened.map(store => store.root), ...roots.splice(0)]) rmSync(root, { recursive: true, force: true }) })
const owner = { issuer: 'https://id.example.test', subject: 'owner' }
function fixture() {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-definitions-'))); stores.push(store)
  const pod = store.createPod({ name: 'Source instance' })
  const resources = new ResourceRegistry(store, () => {})
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  const workspace = new DefinitionWorkspace(store, resources, owner)
  const execute = async (command: unknown) => parseDefinitionsView(await workspace.execute(command, new AbortController().signal))
  const groups = [randomUUID(), randomUUID()]
  for (const [index, id] of groups.entries()) store.db.prepare('INSERT INTO pod_groups VALUES(?,?,0)').run(id!, `Company ${index + 1}`)
  return { store, pod, resources, workspace, execute, groups }
}
async function published(f: ReturnType<typeof fixture>) {
  const view = await f.execute({ type: 'publish', podId: f.pod.id, expectedScript: f.store.getPod(f.pod.id).activeScript, name: 'Reusable example', defaults: { label: 'Public default' } })
  return view.definitions.find(definition => view.instances.some(instance => instance.podId === f.pod.id && instance.definitionId === definition.id))!
}
it('adopts existing instances without changing script history, state or schedules', async () => {
  const f = fixture(); const before = f.store.getPod(f.pod.id)
  const checkpoint = f.store.checkpoint(f.pod.id)
  const script = f.store.db.prepare('SELECT * FROM scripts WHERE pod_id=?').all(f.pod.id)
  const first = await f.execute({ type: 'adopt' }); const second = await f.execute({ type: 'adopt' })
  expect(second).toEqual(first)
  expect(first.definitions[0]!.versions[0]!.state).toBe('legacy')
  expect(f.store.getPod(f.pod.id)).toEqual(before)
  expect(f.store.checkpoint(f.pod.id)).toEqual(checkpoint)
  expect(f.store.db.prepare('SELECT * FROM scripts WHERE pod_id=?').all(f.pod.id)).toEqual(script)
  await expect(f.execute({ type: 'instantiate', requestId: randomUUID(), definitionId: first.definitions[0]!.id, version: 1, name: 'Unpublished', groupId: f.groups[0] })).rejects.toThrow('Publish')
})
it('creates separate paused instances, homes, state and companies without validations or resources', async () => {
  const f = fixture(); const definition = await published(f)
  const sourceHome = (await podDirectories(f.store.root, f.pod.id)).home
  await writeFile(join(sourceHome, 'private-token.txt'), 'synthetic source secret')
  const created: string[] = []
  for (const [index, groupId] of f.groups.entries()) {
    const view = await f.execute({ type: 'instantiate', requestId: randomUUID(), definitionId: definition.id, version: 2, name: `Instance ${index}`, groupId })
    created.push(view.createdPodId!)
    const pod = f.store.getPod(view.createdPodId!)
    expect(pod.lifecycle).toBe('paused'); expect(pod.activeScript).toBeNull()
    expect(f.resources.list(pod.id)).toEqual([])
    expect(f.store.db.prepare('SELECT * FROM validations WHERE pod_id=?').all(pod.id)).toEqual([])
    expect(f.store.checkpoint(pod.id)).toEqual({ revision: 0, body: {} })
    expect(await readdir((await podDirectories(f.store.root, pod.id)).home)).toEqual([])
    expect(view.instances.find(item => item.podId === pod.id)?.groupId).toBe(groupId)
  }
  expect(new Set(created).size).toBe(2)
  expect(created).not.toContain(f.pod.id)
})
it('reuses a failed pending instance and rejects changed request IDs and foreign owners', async () => {
  const f = fixture(); const definition = await published(f)
  const command = { type: 'instantiate', requestId: randomUUID(), definitionId: definition.id, version: 2, name: 'Retry instance', groupId: f.groups[0] }
  const first = await f.execute(command)
  f.workspace.provisioned(command.requestId, 'Synthetic identity provider unavailable')
  const retry = await f.execute({ type: 'retryProvision', requestId: command.requestId })
  expect(retry.createdPodId).toBe(first.createdPodId)
  expect((await f.execute(command)).createdPodId).toBe(first.createdPodId)
  expect(f.store.listPods()).toHaveLength(2)
  const prepared = await f.execute({ type: 'prepareUpdate', podId: first.createdPodId, definitionId: definition.id, version: 2, expectedBinding: 1 })
  expect(prepared.update!.draftId).toBe(f.store.db.prepare('SELECT id FROM script_drafts WHERE pod_id=?').get(first.createdPodId!)!.id)
  expect(f.store.db.prepare('SELECT * FROM script_drafts WHERE pod_id=?').all(first.createdPodId!)).toHaveLength(1)
  await expect(f.execute({ ...command, name: 'Changed' })).rejects.toThrow('reused')
  const other = new DefinitionWorkspace(f.store, f.resources, { ...owner, subject: 'another' })
  await expect(other.execute({ type: 'retryProvision', requestId: command.requestId }, new AbortController().signal)).rejects.toThrow('another owner')
  expect(other.view().definitions).toEqual([])
})
it('requires current validation for publication and shows explicit update differences', async () => {
  const f = fixture(); const definition = await published(f)
  const first = await f.execute({ type: 'instantiate', requestId: randomUUID(), definitionId: definition.id, version: 2, name: 'Pinned', groupId: f.groups[0] })
  installExample(f.store, f.resources, f.pod.id, 'agent', 'a'.repeat(64))
  await f.execute({ type: 'publish', podId: f.pod.id, expectedScript: f.store.getPod(f.pod.id).activeScript, name: definition.name, defaults: { label: 'New default' } })
  const update = await f.execute({ type: 'prepareUpdate', podId: first.createdPodId, definitionId: definition.id, version: 3, expectedBinding: 1 })
  expect(update.update?.changed).toEqual(['code', 'dependencies', 'defaults'])
  expect(update.update?.beforeCode).toBe('')
  expect(update.update?.afterCode).toContain('export async function run')
  await expect(f.execute({ type: 'activateUpdate', podId: first.createdPodId, draftId: update.update!.draftId, expectedBinding: 1 })).rejects.toThrow('Validate')
  expect(f.workspace.view().instances.find(item => item.podId === first.createdPodId)?.version).toBe(2)
  f.resources.assignReference(f.pod.id, 'New resource', join(f.store.root, 'reference.txt'))
  await expect(f.execute({ type: 'publish', podId: f.pod.id, expectedScript: f.store.getPod(f.pod.id).activeScript, name: definition.name, defaults: {} })).rejects.toThrow('Validate')
})

it('validates each exact artifact separately and changes only the explicitly selected instance', async () => {
  const f = fixture(); const definition = await published(f)
  const instances: string[] = []
  const manifest = join(f.store.root, 'runtime.json')
  await writeFile(manifest, JSON.stringify({ dependencyLockHash: 'a'.repeat(64) }))
  const runtime = { manifest, helper: '/unused', environment: {} } as unknown as AgentRuntime
  vi.mocked(executeScript).mockImplementation(async (_runtime, _root, _artifact, input) => ({ status: 'completed', summary: 'Synthetic contract fixture', completedInputIds: input.eventIds, gapIds: [] }))
  for (const groupId of f.groups) {
    const created = await f.execute({ type: 'instantiate', requestId: randomUUID(), definitionId: definition.id, version: 2, name: 'Independent', groupId })
    const podId = created.createdPodId!; instances.push(podId)
    const draft = f.store.db.prepare('SELECT id FROM script_drafts WHERE pod_id=?').get(podId)!.id as string
    const result = await validateDraft(f.store, f.resources, runtime, draft, 1, new AbortController().signal)
    expect(result.hash).toBe(definition.versions[1]!.contentHash)
    expect(() => new WorkspaceDetails(f.store, f.resources).execute({ type: 'activate', podId, hash: result.hash, expectedActive: null, assignmentRevision: 1 })).toThrow('definition update review')
    await f.execute({ type: 'activateUpdate', podId, draftId: draft, expectedBinding: 1 })
  }
  installExample(f.store, f.resources, f.pod.id, 'agent', 'a'.repeat(64))
  await f.execute({ type: 'publish', podId: f.pod.id, expectedScript: f.store.getPod(f.pod.id).activeScript, name: definition.name, defaults: {} })
  const update = await f.execute({ type: 'prepareUpdate', podId: instances[0], definitionId: definition.id, version: 3, expectedBinding: 2 })
  const draftId = update.update!.draftId!
  await validateDraft(f.store, f.resources, runtime, draftId, 1, new AbortController().signal)
  const eventId = randomUUID()
  f.store.db.prepare('INSERT INTO accepted_events(id,pod_id,source,dedupe_key,payload,accepted_at,state) VALUES(?,?,\'manual\',?,\'{}\',?,\'pending\')').run(eventId, instances[0]!, eventId, Date.now())
  await expect(f.execute({ type: 'activateUpdate', podId: instances[0], draftId, expectedBinding: 2 })).rejects.toThrow('Resolve pending instance inputs')
  expect(f.store.db.prepare('SELECT state FROM accepted_events WHERE id=?').get(eventId)!.state).toBe('pending')
  f.store.db.prepare('UPDATE accepted_events SET state=\'processed\' WHERE id=?').run(eventId)
  await f.execute({ type: 'activateUpdate', podId: instances[0], draftId, expectedBinding: 2 })
  expect(f.workspace.view().instances.find(item => item.podId === instances[0])?.version).toBe(3)
  expect(f.workspace.view().instances.find(item => item.podId === instances[1])?.version).toBe(2)
  expect(f.store.getPod(instances[1]!).activeScript).toBe(definition.versions[1]!.contentHash)
  expect(f.store.db.prepare('SELECT * FROM scripts WHERE pod_id=?').all(instances[0]!)).toHaveLength(2)
  expect(f.store.db.prepare('SELECT * FROM validations WHERE pod_id=?').all(instances[1]!)).toHaveLength(1)
  f.store.db.prepare('DELETE FROM definition_update_drafts WHERE draft_id=?').run(draftId)
  expect(() => new WorkspaceDetails(f.store, f.resources).execute({ type: 'activate', podId: instances[0]!, hash: f.store.getPod(instances[0]!).activeScript!, expectedActive: f.store.getPod(instances[0]!).activeScript, assignmentRevision: 1 })).toThrow('definition update review')
  const preserved = f.store.getPod(instances[1]!)
  f.resources.assignReference(instances[1]!, 'Independent reference', join(f.store.root, 'reference.txt'))
  expect(f.store.getPod(instances[1]!).bindingRevision).toBe(preserved.bindingRevision)
  const again = await f.execute({ type: 'prepareUpdate', podId: instances[1], definitionId: definition.id, version: 2, expectedBinding: 2 })
  expect((await validateDraft(f.store, f.resources, runtime, again.update!.draftId!, 1, new AbortController().signal)).hash).toBe(preserved.activeScript)
  await f.execute({ type: 'activateUpdate', podId: instances[1], draftId: again.update!.draftId, expectedBinding: 2 })
})
it('rejects edits to a pinned draft before executing its synthetic validation', async () => {
  const f = fixture(); const definition = await published(f)
  const created = await f.execute({ type: 'instantiate', requestId: randomUUID(), definitionId: definition.id, version: 2, name: 'Changed draft', groupId: f.groups[0] })
  const draftId = f.store.db.prepare('SELECT id FROM script_drafts WHERE pod_id=?').get(created.createdPodId!)!.id as string
  const manifest = join(f.store.root, 'runtime.json'); await writeFile(manifest, JSON.stringify({ dependencyLockHash: 'a'.repeat(64) }))
  f.store.db.prepare('UPDATE script_drafts SET code=? WHERE id=?').run('changed', draftId)
  vi.mocked(executeScript).mockClear()
  await expect(validateDraft(f.store, f.resources, { manifest } as AgentRuntime, draftId, 1, new AbortController().signal)).rejects.toThrow('immutable version')
  expect(executeScript).not.toHaveBeenCalled()
})

it('allows deleting an adopted legacy instance and explicitly preserves published sources', async () => {
  const f = fixture(); await f.execute({ type: 'adopt' })
  f.store.updatePod(f.pod.id, f.pod.revision, { name: f.pod.name, lifecycle: 'archived' })
  await new DataRetention(f.store, '').deletePod(f.pod.id, f.store.getPod(f.pod.id).revision, f.pod.name)
  expect(f.store.listPods()).toEqual([])
  expect(f.workspace.view().definitions).toEqual([])
  const g = fixture(); await published(g)
  g.store.updatePod(g.pod.id, g.pod.revision, { name: g.pod.name, lifecycle: 'archived' })
  await expect(new DataRetention(g.store, '').deletePod(g.pod.id, g.store.getPod(g.pod.id).revision, g.pod.name)).rejects.toThrow('published definition source')
  expect(g.store.db.prepare('SELECT * FROM deletion_jobs').all()).toEqual([])
})
it('skips foreign owners during adoption and makes identical publication retries idempotent', async () => {
  const f = fixture(); const foreign = f.store.createPod({ name: 'Foreign instance' })
  f.store.db.prepare('INSERT INTO remote_pods VALUES(?,?,?,?,?,?,NULL)').run(foreign.id, JSON.stringify({ ...owner, subject: 'other' }), 'runtime', 'generation', 'ready', '{}')
  const first = await published(f); const second = await published(f)
  expect(second.versions).toEqual(first.versions)
  expect(f.workspace.view().instances.map(item => item.podId)).not.toContain(foreign.id)
  await f.execute({ type: 'adopt' })
  expect(f.workspace.view().instances).toHaveLength(1)
  expect(() => f.workspace.provisioned(randomUUID(), null)).toThrow('not found')
})
it('repins an idle compatible network as a paused revision without reviving archived networks', () => {
  const f = networkFixture()
  const source = f.pod('Source', { takes: [], gives: ['input'], summary: 'Source' }, async () => {})
  const sink = f.pod('Sink', { takes: ['input'], gives: [], summary: 'Sink' }, async () => {})
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: sink, source: null, serialCase: true }], ['input'])
  const binding = f.store.db.prepare('SELECT * FROM instance_definition_bindings WHERE pod_id=?').get(sink)!
  f.store.db.prepare('INSERT INTO pod_definition_versions SELECT definition_id,2,content_hash,lock_hash,contract,created_at FROM pod_definition_versions WHERE definition_id=? AND version=1').run(binding.definition_id!)
  f.engine.execute({ type: 'activate', id, revision: 1 })
  f.engine.updateInstance(sink, () => { f.store.db.prepare('UPDATE instance_definition_bindings SET definition_version=2,binding_revision=2 WHERE pod_id=?').run(sink) })
  expect(f.store.db.prepare('SELECT state,revision,baseline_state FROM networks WHERE id=?').get(id)).toEqual({ state: 'paused', revision: 2, baseline_state: 'ready' })
  expect(f.store.db.prepare('SELECT revision FROM network_revisions WHERE network_id=? ORDER BY revision').all(id)).toEqual([{ revision: 1 }, { revision: 2 }])
  expect(f.engine.execute({ type: 'activate', id, revision: 2 }).networks[0]!.state).toBe('active')
  f.store.db.prepare('INSERT INTO pod_definition_versions SELECT definition_id,3,content_hash,lock_hash,?,created_at FROM pod_definition_versions WHERE definition_id=? AND version=1').run(JSON.stringify({ takes: ['missing'], gives: [], summary: 'Incompatible' }), binding.definition_id!)
  expect(() => f.engine.updateInstance(sink, () => { f.store.db.prepare('UPDATE instance_definition_bindings SET definition_version=3,binding_revision=3 WHERE pod_id=?').run(sink) })).toThrow()
  expect(f.store.db.prepare('SELECT definition_version,binding_revision FROM instance_definition_bindings WHERE pod_id=?').get(sink)).toEqual({ definition_version: 2, binding_revision: 2 })
  expect(f.store.db.prepare('SELECT state,revision FROM networks WHERE id=?').get(id)).toEqual({ state: 'active', revision: 2 })
  f.store.db.prepare('UPDATE networks SET state=\'archived\' WHERE id=?').run(id)
  const update = vi.fn()
  expect(() => f.engine.updateInstance(sink, update)).toThrow('Archived')
  expect(update).not.toHaveBeenCalled()
  expect(f.store.db.prepare('SELECT state FROM networks WHERE id=?').get(id)!.state).toBe('archived')
})
it('retains old version processing when an open join blocks a network update', () => {
  const f = networkFixture()
  const source = f.pod('Source', { takes: [], gives: ['input'], summary: 'Source' }, async () => {})
  const sink = f.pod('Sink', { takes: ['input'], gives: [], summary: 'Sink' }, async () => {})
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: sink, source: null, serialCase: true }], ['input'])
  const caseId = randomUUID()
  f.store.transaction(() => {
    f.store.db.prepare('INSERT INTO network_cases VALUES(?,?,?,1,NULL,NULL,?)').run(caseId, id, f.groupId, Date.now())
    f.store.db.prepare('INSERT INTO network_case_revisions VALUES(?,1,\'{}\',NULL,\'open\',?)').run(caseId, Date.now())
    f.store.db.prepare('INSERT INTO network_joins VALUES(?,?,?,1,1,?, ?,\'pending\',NULL)').run(id, 'waiting', caseId, '{}', Date.now() + 10000)
  })
  const update = vi.fn()
  expect(() => f.engine.updateInstance(sink, update)).toThrow('current version remains pinned')
  expect(update).not.toHaveBeenCalled()
  expect(f.store.db.prepare('SELECT definition_version,binding_revision FROM instance_definition_bindings WHERE pod_id=?').get(sink)).toEqual({ definition_version: 1, binding_revision: 1 })
})

it('backs up adopted empty scripts and restores the same instance identity as requiring recovery', async () => {
  const f = fixture(); const empty = f.store.createPod({ name: 'No script yet' })
  await f.execute({ type: 'adopt' }); const definition = await published(f)
  const requestId = randomUUID()
  const created = await f.execute({ type: 'instantiate', requestId, definitionId: definition.id, version: 2, name: 'Restorable instance', groupId: f.groups[0] })
  const podId = created.createdPodId!
  f.store.db.prepare('INSERT INTO remote_pods VALUES(?,?,?,?,?,?,NULL)').run(podId, JSON.stringify(owner), 'runtime', 'generation', 'ready', JSON.stringify({ podId, subject: 'synthetic' }))
  f.workspace.provisioned(requestId, null)
  const exports = mkdtempSync(join(tmpdir(), 'pods-definition-backups-')); roots.push(exports)
  const backup = await createBackup(f.store, exports)
  const restoredRoot = await restoreBackup(backup, exports, schemaVersion)
  const restored = new PodDatabase(restoredRoot); stores.push(restored)
  const recovery = new DefinitionWorkspace(restored, new ResourceRegistry(restored, () => {}), owner)
  const priorDrafts = restored.db.prepare('SELECT * FROM script_drafts WHERE pod_id=?').all(podId)
  await expect(recovery.execute({ type: 'retryProvision', requestId }, new AbortController().signal)).rejects.toThrow('must never be provisioned again')
  expect(restored.db.prepare('SELECT * FROM script_drafts WHERE pod_id=?').all(podId)).toEqual(priorDrafts)
  expect(restored.getPod(empty.id).activeScript).toBeNull()
  expect(restored.db.prepare('SELECT pod_id,state,error FROM definition_instance_requests WHERE id=?').get(requestId)).toMatchObject({ pod_id: podId, state: 'failed', error: expect.stringContaining('existing identity') })
  expect(restored.db.prepare('SELECT phase,identity FROM remote_pods WHERE pod_id=?').get(podId)).toMatchObject({ phase: 'needs_desktop_action', identity: JSON.stringify({ podId, subject: 'synthetic' }) })
  restored.db.prepare('UPDATE remote_pods SET phase=\'ready\' WHERE pod_id=?').run(podId)
  const recovered = await recovery.execute({ type: 'retryProvision', requestId }, new AbortController().signal)
  expect(recovered.provisioning.find(item => item.requestId === requestId)!.state).toBe('ready')
  expect(restored.db.prepare('SELECT * FROM script_drafts WHERE pod_id=?').all(podId)).toEqual(priorDrafts)
})

it('validates and activates a network definition through the workspace and rejects stale permissions', async () => {
  const f = networkFixture()
  const source = f.pod('Source', { takes: [], gives: ['input'], summary: 'Source' }, async () => {})
  const sink = f.pod('Sink', { takes: ['input'], gives: [], summary: 'Sink' }, async () => {})
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: sink, source: null, serialCase: true }], ['input'])
  const workspace = new DefinitionWorkspace(f.store, f.resources, f.owner, (podId, update) => f.engine.updateInstance(podId, update))
  const execute = (command: unknown) => workspace.execute(command, new AbortController().signal)
  const definitionId = workspace.view().instances.find(instance => instance.podId === sink)!.definitionId
  await execute({ type: 'publish', podId: sink, expectedScript: f.store.getPod(sink).activeScript, name: 'Reusable sink', defaults: { label: 'Reviewed' } })
  const update = await execute({ type: 'prepareUpdate', podId: sink, definitionId, version: 2, expectedBinding: 1 })
  const draftId = update.update!.draftId!
  const manifest = join(f.store.root, 'runtime.json'); await writeFile(manifest, JSON.stringify({ dependencyLockHash: 'a'.repeat(64) }))
  const runtime = { manifest, helper: '/unused', environment: {} } as unknown as AgentRuntime
  await validateDraft(f.store, f.resources, runtime, draftId, 1, new AbortController().signal)
  f.resources.assignReference(sink, 'Own reference', join(f.store.root, 'reference.txt'))
  await expect(execute({ type: 'activateUpdate', podId: sink, draftId, expectedBinding: 1 })).rejects.toThrow('current script and permissions')
  expect(workspace.view().instances.find(instance => instance.podId === sink)!.version).toBe(1)
  expect(f.store.db.prepare('SELECT revision FROM networks WHERE id=?').get(id)!.revision).toBe(1)
  await validateDraft(f.store, f.resources, runtime, draftId, 1, new AbortController().signal)
  await execute({ type: 'activateUpdate', podId: sink, draftId, expectedBinding: 1 })
  expect(workspace.view().instances.find(instance => instance.podId === sink)).toMatchObject({ version: 2, bindingRevision: 2, diverged: false })
  expect(f.store.db.prepare('SELECT state,revision FROM networks WHERE id=?').get(id)).toEqual({ state: 'paused', revision: 2 })
  expect(f.store.db.prepare('SELECT network_revision FROM network_subscriptions WHERE pod_id=? ORDER BY network_revision').all(sink)).toEqual([{ network_revision: 1 }, { network_revision: 2 }])
})

it.each(['http', 'ssh', 'app'])('refuses publication of instance-specific %s capabilities before creating a definition', async (kind) => {
  const f = fixture(); const hash = f.store.getPod(f.pod.id).activeScript!
  const row = f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(f.pod.id, hash)!
  const manifest = JSON.parse(row.manifest as string); manifest.capabilities = [`tool.${kind}_${'a'.repeat(32)}.invoke`]
  f.store.db.prepare('UPDATE scripts SET manifest=? WHERE pod_id=? AND hash=?').run(JSON.stringify(manifest), f.pod.id, hash)
  await expect(published(f)).rejects.toThrow('instance-specific HTTP, SSH or program rights')
  expect(f.workspace.view().definitions).toEqual([])
})
it('enforces the existing instance limit without duplicating a retry at capacity', async () => {
  const f = fixture(); const definition = await published(f)
  const command = { type: 'instantiate', requestId: randomUUID(), definitionId: definition.id, version: 2, name: 'Last accepted', groupId: f.groups[0] }
  const first = await f.execute(command)
  while (f.store.listPods().length < 100) f.store.createPod({ name: 'Existing fixture' })
  expect((await f.execute(command)).createdPodId).toBe(first.createdPodId)
  await expect(f.execute({ ...command, requestId: randomUUID() })).rejects.toThrow('Local pod limit')
  expect(f.store.listPods()).toHaveLength(100)
})
