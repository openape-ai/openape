// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase, digest } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { installExample } from '../../src/worker/runs/examples'
import { SetupControl } from '../../src/worker/onboarding/control'
import { executeScript } from '../../src/worker/runs/runner'
import { parseJevRequest, syntheticJevResult, defaultJevModel } from '../../src/contracts/jev'
import type { AgentRuntime } from '../../src/worker/agent/executor'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
const stores: PodDatabase[] = []
afterEach(() => { vi.restoreAllMocks(); for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })
const request = parseJevRequest({ state: 'PRIVATE_SYNTHETIC_INPUT', questions: { reply: { type: 'noul', instructions: 'Reply needed?' } } })
function fixture(fail = false) {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-jev-run-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const pod = store.createPod({ name: 'Jev-only run' }); const setup = new SetupControl(store, resources); const id = randomUUID()
  setup.execute({ type: 'save', connection: { id, provider: 'typesafe', account: 'TypeSafe / Jev', state: 'ready', error: null }, metadata: { verifiedAt: 1 } })
  resources.assignJev(pod.id, id, defaultJevModel, 20, { ownerConnection: randomUUID(), grantId: 'fixture', identity: { connectionId: randomUUID(), podId: pod.id, issuer: 'https://id.example.invalid', owner: 'owner@example.invalid', subject: 'pod@example.invalid', keyId: 'key' } }, resources.epoch(pod.id))
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  const hash = store.getPod(pod.id).activeScript!
  const row = store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(pod.id, hash)!
  const manifest = JSON.parse(String(row.manifest)); manifest.capabilities = ['jev.evaluate']
  store.db.prepare('UPDATE scripts SET manifest=? WHERE pod_id=? AND hash=?').run(JSON.stringify(manifest), pod.id, hash)
  const jev = vi.fn(async () => { if (fail) throw new Error('TypeSafe network request failed'); return { result: syntheticJevResult(request, defaultJevModel), attempts: 1 } })
  vi.spyOn(resources, 'capture').mockResolvedValue({ id: randomUUID(), files: [] } as never)
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime, { jev })
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    hooks.event('operation', { id: 'decision', operation: 'jev.evaluate', state: 'started' })
    const result = await hooks.request('jev.evaluate', request, signal)
    expect(result).toMatchObject({ model: defaultJevModel, answers: { reply: { type: 'noul' } } })
    hooks.event('operation', { id: 'decision', operation: 'jev.evaluate', state: 'completed' })
    return { status: 'completed', summary: 'Decision received', completedInputIds: input.eventIds, gapIds: [] }
  })
  return { store, resources, pod, dispatcher, jev }
}
it.each([false, true])('executes Jev without a Codex provider and leaves the delivery ledger clear (failure: %s)', async (failure) => {
  const f = fixture(failure)
  f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.view(f.pod.id).runs[0]?.state).toBe(failure ? 'failed' : 'completed')
  const view = f.dispatcher.view(f.pod.id)
  expect(f.jev).toHaveBeenCalledTimes(1)
  expect(view.events.some(event => event.type === 'agent')).toBe(false)
  expect(f.store.db.prepare('SELECT * FROM effect_ledger').all()).toEqual([])
  expect(JSON.stringify(view.events)).not.toContain(request.state)
  if (!failure) expect(view.events.find(event => event.type === 'jev')?.data).toMatchObject({ model: defaultJevModel, attempts: 1, usage: { input_tokens: 0, output_tokens: 0 } })
})
it('refuses a script without the Jev capability before calling its provider', async () => {
  const f = fixture()
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, _input, signal, hooks) => { await hooks.request('jev.evaluate', request, signal); throw new Error('must not reach') })
  const hash = f.store.getPod(f.pod.id).activeScript!
  const row = f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(f.pod.id, hash)!
  const manifest = JSON.parse(String(row.manifest)); manifest.capabilities = []
  f.store.db.prepare('UPDATE scripts SET manifest=? WHERE pod_id=? AND hash=?').run(JSON.stringify(manifest), f.pod.id, hash)
  f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.view(f.pod.id).runs[0]?.state).toBe('failed')
  expect(f.dispatcher.view(f.pod.id).runs[0]?.error).toContain('not assigned')
  expect(f.jev).not.toHaveBeenCalled()
  expect(digest(f.store.readBlob(hash))).toBe(hash)
})
