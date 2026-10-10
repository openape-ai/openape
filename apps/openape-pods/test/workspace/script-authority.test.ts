// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunStore } from '../../src/worker/runs/store'
import { installExample } from '../../src/worker/runs/examples'
import { MasterControl } from '../../src/worker/master/control'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { parseCommand } from '../../src/contracts/control'
import { parseMasterAction } from '../../src/contracts/master'

const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })
it('creates and renames without a second instruction, retaining active script validation', async () => {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-authority-'))); stores.push(store)
  const pod = store.createPod({ name: 'Mail alarm' })
  expect(pod).not.toHaveProperty('assignment')
  const resources = new ResourceRegistry(store, () => {})
  const dispatcher = new RunDispatcher(store, resources, {} as AgentRuntime)
  const control = new MasterControl(store, resources, dispatcher, new Scheduler(store, dispatcher), {} as AgentRuntime)
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  const hash = store.getPod(pod.id).activeScript!
  const validations = store.db.prepare('SELECT * FROM validations').all()
  await control.execute('rename', { action: 'revise', podId: pod.id, revision: pod.revision, name: 'Inbox alerts' }, new AbortController().signal)
  const renamed = store.getPod(pod.id)
  expect(renamed).toMatchObject({ name: 'Inbox alerts', revision: 2, activeScript: hash, lifecycle: 'paused' })
  expect(store.db.prepare('SELECT * FROM validations').all()).toEqual(validations)
  const runs = new RunStore(store)
  const run = runs.reserve(pod.id, hash, resources.epoch(pod.id))
  expect(run).toBeTruthy()
  expect(() => store.updatePod(pod.id, 1, { name: 'Stale', lifecycle: 'paused' })).toThrow('Stale')
  expect(() => parseCommand({ type: 'create', name: 'Bad', assignment: 'Hidden instruction' })).toThrow()
  expect(() => parseMasterAction({ action: 'create', name: 'Bad', assignment: 'Hidden instruction' })).toThrow()
})
