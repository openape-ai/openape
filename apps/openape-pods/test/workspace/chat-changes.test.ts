// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { MasterControl } from '../../src/worker/master/control'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { ChatRegistry } from '../../src/worker/master/chat-registry'
import { PodVariables } from '../../src/worker/resources/variables'
import { installExample } from '../../src/worker/runs/examples'
import { RunStore } from '../../src/worker/runs/store'
import { parseMasterCommand } from '../../src/contracts/master'

const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })
function fixture() {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-chat-changes-'))); stores.push(store)
  const pods = [store.createPod({ name: 'Filter' }), store.createPod({ name: 'Report' })]
  const resources = new ResourceRegistry(store, () => {}); const runtime = {} as AgentRuntime
  const dispatcher = new RunDispatcher(store, resources, runtime); const scheduler = new Scheduler(store, dispatcher)
  const control = new MasterControl(store, resources, dispatcher, scheduler, runtime)
  const chats = new ChatRegistry(store); const id = randomUUID()
  chats.execute({ type: 'create', id, title: 'Together', podIds: pods.map(pod => pod.id) })
  return { store, pods, resources, control, chats, context: chats.get(id) }
}

it('applies a change in the selected context directly and records no change review', async () => {
  const { store, pods, control, context } = fixture()
  for (const pod of pods) await control.execute(randomUUID(), { action: 'setVariable', podId: pod.id, revision: pod.revision, name: 'mode', value: 'preview', variableRevision: 0 }, new AbortController().signal, context)
  expect(pods.map(pod => new PodVariables(store).list(pod.id).map(item => item.value))).toEqual([['preview'], ['preview']])
})

it('enforces model context on reads and writes and offers no change decision', async () => {
  const { pods, chats, control } = fixture(); const workspace = chats.ensure('')
  for (const action of ['inspect', 'run', 'resume']) await expect(control.execute(randomUUID(), { action, podId: pods[0]!.id, revision: 1 }, new AbortController().signal, workspace)).rejects.toThrow('context_required')
  for (const type of ['applyChanges', 'discardChanges']) expect(() => parseMasterCommand({ type, id: randomUUID(), revision: 1, conversationId: randomUUID(), contextRevision: 1 })).toThrow('Unsupported')
  await expect(control.execute(randomUUID(), { action: 'applyChanges', approved: true }, new AbortController().signal, workspace)).rejects.toThrow('not allowed')
})

// Issue 1455: there is no in-app model turn; an assistant mutates Pods only through the MCP owner session.
it('accepts no in-app conversation turn that could call pods_control', () => {
  const id = randomUUID()
  for (const command of [{ type: 'send', id, text: 'Enable the schedule', podId: null }, { type: 'steer', id, text: 'Resume it', podId: null }, { type: 'begin', id }, { type: 'cancel' }]) expect(() => parseMasterCommand(command)).toThrow('Unsupported master request')
})

it('keeps unrelated scheduler reservations when an owner control start is refused', async () => {
  const f = fixture(); const other = f.pods[1]!.id
  installExample(f.store, f.resources, other, 'deterministic', 'a'.repeat(64))
  const runs = new RunStore(f.store); let calls = 0; let admitted = ''
  const control = new MasterControl(f.store, f.resources, {} as RunDispatcher, {} as Scheduler, {} as AgentRuntime, () => {
    calls++
    admitted = runs.reserve(other, f.store.getPod(other).activeScript!, f.resources.epoch(other), { reason: 'manual', eventIds: [] }).run.id
    throw new Error('Synthetic fair slot refusal after another domain reserved work')
  })
  const key = randomUUID()
  const request = { action: 'run', podId: f.pods[0]!.id, revision: f.pods[0]!.revision }
  await expect(control.execute(key, request, new AbortController().signal)).rejects.toThrow('fair slot refusal')
  expect(f.store.db.prepare('SELECT state FROM runs WHERE id=?').get(admitted)!.state).toBe('running')
  expect(f.store.db.prepare('SELECT run_id FROM run_leases WHERE pod_id=?').get(other)!.run_id).toBe(admitted)
  expect(f.store.db.prepare('SELECT state FROM master_actions WHERE id=?').get(key)!.state).toBe('failed')
  await expect(control.execute(key, request, new AbortController().signal)).rejects.toThrow('fair slot refusal')
  expect(calls).toBe(1)
})

it('retains the durable owner run identity when scheduling throws after admission', async () => {
  const f = fixture(); const podId = f.pods[0]!.id
  installExample(f.store, f.resources, podId, 'deterministic', 'a'.repeat(64))
  const runs = new RunStore(f.store); let calls = 0; let admitted = ''
  const control = new MasterControl(f.store, f.resources, {} as RunDispatcher, {} as Scheduler, {} as AgentRuntime, (id, operationId) => {
    calls++
    admitted = runs.reserve(id, f.store.getPod(id).activeScript!, f.resources.epoch(id), { reason: 'manual', eventIds: [], operationId }).run.id
    throw new Error('Synthetic scheduler receipt failure after admission')
  })
  const key = randomUUID()
  const request = { action: 'run', podId, revision: f.store.getPod(podId).revision }
  await expect(control.execute(key, request, new AbortController().signal)).rejects.toThrow('after admission')
  expect(f.store.db.prepare('SELECT state,result FROM master_actions WHERE id=?').get(key)).toEqual({ state: 'running', result: JSON.stringify({ runId: admitted }) })
  expect(f.store.db.prepare('SELECT run_id FROM run_leases WHERE pod_id=?').get(podId)!.run_id).toBe(admitted)
  await expect(control.execute(key, request, new AbortController().signal)).rejects.toThrow('after admission')
  expect(calls).toBe(1)
  expect(runs.list(podId)).toHaveLength(1)
})
