// @vitest-environment node
import { removeWorkflowSchema } from '../storage/legacy'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { WorkspaceDetails } from '../../src/worker/workspace/details'
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
  await control.execute('rename', { action: 'revise', podId: pod.id, revision: pod.revision, name: 'Inbox alerts' }, new AbortController().signal, pod.id)
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
it('migrates existing bindings without reviving stale scripts or exposing historical instructions', () => {
  let store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-authority-migration-'))); stores.push(store)
  const pod = store.createPod({ name: 'Legacy' })
  const resources = new ResourceRegistry(store, () => {})
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  const stale = store.getPod(pod.id).activeScript!
  store.db.prepare('UPDATE pods SET revision=7,metadata_revision=7,assignment=? WHERE id=?').run('Historical instruction, never execute', pod.id)
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  const current = store.getPod(pod.id).activeScript!
  const scripts = store.db.prepare('SELECT * FROM scripts').all()
  const validations = store.db.prepare('SELECT * FROM validations').all()
  removeWorkflowSchema(store.db)
  store.db.exec('ALTER TABLE pods DROP COLUMN metadata_revision; DROP TABLE script_dependencies; DROP TABLE dependency_sets; DROP TABLE draft_packages; DROP TABLE dependency_domains; ALTER TABLE onboarding DROP COLUMN default_owner; PRAGMA user_version=15')
  const root = store.root; store.close(); stores.splice(stores.indexOf(store), 1)
  store = new PodDatabase(root); stores.push(store)
  expect(store.getPod(pod.id)).toMatchObject({ revision: 7, bindingRevision: 7, activeScript: current })
  expect(store.getPod(pod.id)).not.toHaveProperty('assignment')
  expect(store.db.prepare('SELECT assignment FROM pods').get()?.assignment).toBe('Historical instruction, never execute')
  expect(store.db.prepare('SELECT * FROM scripts').all()).toEqual(scripts)
  expect(store.db.prepare('SELECT * FROM validations').all()).toEqual(validations)
  store.updatePod(pod.id, 7, { name: 'Renamed legacy', lifecycle: 'paused' })
  expect(store.getPod(pod.id)).toMatchObject({ revision: 8, bindingRevision: 7 })
  const details = new WorkspaceDetails(store, new ResourceRegistry(store, () => {}))
  expect(() => details.execute({ type: 'activate', podId: pod.id, hash: stale, expectedActive: current, assignmentRevision: 1 })).toThrow('changed')
  const runs = new RunStore(store)
  expect(() => runs.reserve(pod.id, stale, 0)).toThrow('no longer active')
  expect(runs.reserve(pod.id, current, 0).run.state).toBe('running')
})
