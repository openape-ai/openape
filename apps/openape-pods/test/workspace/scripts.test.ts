// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { ScriptWorkspace } from '../../src/worker/workspace/scripts'
import { MasterControl } from '../../src/worker/master/control'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { installExample } from '../../src/worker/runs/examples'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { parseScriptCommand, parseScriptView } from '../../src/contracts/scripts'

const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })
function fixture() {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-script-editor-'))); stores.push(store)
  const pod = store.createPod({ name: 'Script owner', assignment: 'Review synthetic evidence' })
  const resources = new ResourceRegistry(store, () => {})
  const runtime = {} as AgentRuntime
  const dispatcher = new RunDispatcher(store, resources, runtime)
  const scheduler = new Scheduler(store, dispatcher)
  const control = new MasterControl(store, resources, dispatcher, scheduler, runtime)
  const editor = new ScriptWorkspace(store, resources, control)
  const execute = (command: Parameters<ScriptWorkspace['execute']>[0]) => editor.execute(command, new AbortController().signal)
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  return { store, pod, resources, execute }
}
it('reads the exact hashed script, rejects another pod and detects a corrupt blob', async () => {
  const f = fixture(); const view = parseScriptView(await f.execute({ type: 'list', podId: f.pod.id }))
  expect(view.source?.code).toBe(f.store.readBlob(view.pod.activeScript!).toString('utf8'))
  const other = f.store.createPod({ name: 'Other', assignment: 'Separate scope' })
  await expect(f.execute({ type: 'list', podId: other.id, selection: { kind: 'version', id: view.source!.id } })).rejects.toThrow('not assigned')
  writeFileSync(join(f.store.blobs, view.source!.id), 'corrupted')
  await expect(f.execute({ type: 'list', podId: f.pod.id })).rejects.toThrow()
})
it('persists literal draft edits, rejects stale revisions and clears validation after edits', async () => {
  const f = fixture(); const original = f.store.getPod(f.pod.id).activeScript
  const saved = await f.execute({ type: 'save', podId: f.pod.id, revision: 1, draftId: null, draftRevision: 0, code: '// <script>untrusted()</script>\nexport async function run() {}', capabilities: [] })
  const source = saved.source!
  expect((await f.execute({ type: 'list', podId: f.pod.id })).source?.code).toBe(source.code)
  expect((await f.execute({ type: 'list', podId: f.pod.id, selection: { kind: 'draft', id: source.id } })).source?.code).toBe(source.code)
  const command = { type: 'save' as const, podId: f.pod.id, revision: 1, draftId: source.id, draftRevision: 1, code: 'export async function run() { return {} }', capabilities: [] }
  const changed = await f.execute(command); expect(changed.source?.revision).toBe(2); expect(changed.source?.validated).toBe(false)
  await expect(f.execute(command)).rejects.toThrow('Draft changed')
  expect(f.store.getPod(f.pod.id).activeScript).toBe(original)
  const other = f.store.createPod({ name: 'Other', assignment: 'Separate scope' })
  await expect(f.execute({ ...command, podId: other.id, draftRevision: 2 })).rejects.toThrow('another pod')
})
it('requires current active version and permissions for owner activation', async () => {
  const f = fixture(); const first = f.store.getPod(f.pod.id).activeScript!
  installExample(f.store, f.resources, f.pod.id, 'agent', 'a'.repeat(64)); const second = f.store.getPod(f.pod.id).activeScript!
  const command = { type: 'activate' as const, podId: f.pod.id, revision: 1, hash: first, expectedActive: second }
  expect((await f.execute(command)).pod.activeScript).toBe(first)
  await expect(f.execute(command)).rejects.toThrow('changed')
  f.resources.assignReference(f.pod.id, 'Reference', join(f.store.root, 'reference.txt'))
  expect((await f.execute({ type: 'list', podId: f.pod.id })).source?.validated).toBe(false)
  await expect(f.execute({ ...command, expectedActive: first })).rejects.toThrow('Validate')
})
it('rejects archived edits and unsupported or oversized owner requests', async () => {
  const f = fixture(); const command = { type: 'save' as const, podId: f.pod.id, revision: 1, draftId: null, draftRevision: 0, code: 'export async function run() {}', capabilities: [] }
  for (const extra of [{ capabilities: ['shell.exec'] }, { code: 'a'.repeat(150001) }, { path: '/etc/passwd' }, { type: 'run' }]) expect(() => parseScriptCommand({ ...command, ...extra })).toThrow()
  f.store.updatePod(f.pod.id, 1, { name: f.pod.name, assignment: f.pod.assignment, lifecycle: 'archived' })
  await expect(f.execute({ ...command, revision: 2 })).rejects.toThrow('Archived')
})
