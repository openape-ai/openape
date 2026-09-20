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
  chats.execute({ type: 'create', id, title: 'Together', podIds: pods.map(pod => pod.id), workflowId: null, workflowRevision: null })
  const context = chats.get(id)
  const prepare = async () => {
    for (const pod of pods) await control.execute(randomUUID(), { action: 'setVariable', podId: pod.id, revision: pod.revision, name: 'mode', value: 'preview', variableRevision: 0 }, new AbortController().signal, null, null, context)
    return control.changes().list(id)[0]!
  }
  return { store, pods, resources, control, chats, context, prepare }
}
it('prepares both Pods without changing configuration and commits one durable repeatable receipt', async () => {
  const { store, pods, control, context, prepare } = fixture(); const set = await prepare()
  const variables = new PodVariables(store)
  expect(pods.map(pod => variables.list(pod.id))).toEqual([[], []])
  const applied = control.decide(context, set.id, set.revision, 'applyChanges')
  expect(applied.state).toBe('applied'); expect(applied.results).toHaveLength(2)
  expect(pods.map(pod => variables.values(pod.id))).toEqual([{ mode: 'preview' }, { mode: 'preview' }])
  expect(control.decide(context, set.id, set.revision, 'applyChanges')).toEqual(applied)
  expect(pods.map(pod => variables.list(pod.id)[0]?.revision)).toEqual([1, 1])
  expect(() => control.decide(context, set.id, set.revision, 'discardChanges')).toThrow('conflicts')
})
it.each(['configuration', 'permission', 'program lease', 'context'])('applies neither target after a concurrent %s change', async (kind) => {
  const { store, pods, resources, control, chats, context, prepare } = fixture(); const set = await prepare(); const second = pods[1]!
  if (kind === 'configuration') store.updatePod(second.id, second.revision, { name: 'Changed elsewhere', lifecycle: 'paused' })
  if (kind === 'permission') resources.assignReference(second.id, 'New file', '/tmp/synthetic.txt')
  if (kind === 'program lease') store.db.prepare('INSERT INTO program_leases VALUES(?,?,?,?,?)').run(second.id, 'session', 'app', 0, 1)
  if (kind === 'context') chats.execute({ type: 'context', id: context.id, revision: 1, podIds: [pods[0]!.id], workflowId: null, workflowRevision: null })
  const result = control.decide(context, set.id, set.revision, 'applyChanges')
  expect(result.state).toBe('pending'); expect(result.error).toBeTruthy()
  if (kind !== 'context') expect(result.errorPodId).toBe(second.id)
  expect(pods.map(pod => new PodVariables(store).list(pod.id))).toEqual([[], []])
})
it('rolls back earlier targets when a later operation fails and retains the review', async () => {
  const { store, pods, control, context, prepare } = fixture(); await prepare()
  await control.execute(randomUUID(), { action: 'rollback', podId: pods[1]!.id, revision: 1, hash: 'a'.repeat(64), expectedActive: null }, new AbortController().signal, null, null, context)
  const set = control.changes().list(context.id)[0]!
  expect(control.decide(context, set.id, set.revision, 'applyChanges').error).toContain('not found')
  expect(pods.map(pod => new PodVariables(store).list(pod.id))).toEqual([[], []])
})
it('enforces model context on reads and writes, and cannot accept a forged owner decision', async () => {
  const { pods, chats, control } = fixture(); const workspace = chats.ensure('')
  for (const action of ['inspect', 'run', 'resume']) await expect(control.execute(randomUUID(), { action, podId: pods[0]!.id, revision: 1 }, new AbortController().signal, null, null, workspace)).rejects.toThrow('context_required')
  expect(() => parseMasterCommand({ type: 'applyChanges', id: randomUUID(), revision: 1, approved: true })).toThrow()
  await expect(control.execute(randomUUID(), { action: 'applyChanges', approved: true }, new AbortController().signal, null, null, workspace)).rejects.toThrow('not allowed')
})
it('a model run request persists review without creating a run or schedule', async () => {
  const { store, pods, control, context } = fixture()
  await control.execute(randomUUID(), { action: 'run', podId: pods[0]!.id, revision: 1 }, new AbortController().signal, null, null, context)
  expect(control.changes().list(context.id)[0]).toMatchObject({ kind: 'run', state: 'pending' })
  expect(store.db.prepare('SELECT count(*) AS count FROM runs').get()?.count).toBe(0)
  expect(store.db.prepare('SELECT count(*) AS count FROM schedules').get()?.count).toBe(0)
})

it('distinguishes a historical apply receipt from later configuration changes', async () => {
  const { store, pods, control, context, prepare } = fixture(); const set = await prepare()
  control.decide(context, set.id, set.revision, 'applyChanges')
  expect(control.changes().list(context.id)[0]?.targets.every(target => !target.changedSinceApply)).toBe(true)
  new PodVariables(store).save(pods[0]!.id, 'mode', 'later', 1)
  expect(control.changes().list(context.id)[0]?.targets.map(target => target.changedSinceApply)).toEqual([true, false])
})

it('retains the actual run identity when acceptance is interrupted after reservation', () => {
  const { store, pods, resources, control, context } = fixture(); const podId = pods[0]!.id
  installExample(store, resources, podId, 'deterministic', 'a'.repeat(64))
  const pod = store.getPod(podId); const set = control.changes().prepare(context, { action: 'run', podId, revision: pod.revision })
  const runs = new RunStore(store)
  const result = control.changes().execute(context, set.id, set.revision, 'applyChanges', () => {}, (id, operationId) => {
    runs.reserve(id, pod.activeScript!, resources.epoch(id), { reason: 'manual', eventIds: [], operationId })
    throw new Error('Synthetic interruption after reservation')
  })
  expect(result.state).toBe('failed')
  const receipt = control.changes().list(context.id)[0]!
  expect(receipt.execution?.[0]).toMatchObject({ podId, state: 'running', runId: runs.list(podId)[0]!.id })
  expect(() => control.decide(context, set.id, set.revision, 'applyChanges')).toThrow('automatic retry')
  expect(runs.list(podId)).toHaveLength(1)
})
