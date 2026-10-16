// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { installExample } from '../../src/worker/runs/examples'
import { executeScript } from '../../src/worker/runs/runner'
import type { ScriptServices } from '../../src/worker/runs/runner'
import type { AgentRuntime } from '../../src/worker/agent/executor'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
const stores: PodDatabase[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) }
})

it('reads only the current leased run and subtracts overlapping approval waits without resetting budgets', async () => {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-run-timing-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const pod = store.createPod({ name: 'Synthetic timed operation' })
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  vi.spyOn(resources, 'capture').mockResolvedValue({ id: randomUUID(), files: [] } as never)
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime)
  let now = 1000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  let saved: (() => Promise<unknown>) | undefined
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, services: ScriptServices) => {
    saved = () => services.request('run.timing', {}, signal)
    now = 1200
    const grant = { grantId: 'first', issuer: 'https://id.example.invalid', title: 'Synthetic permission', state: 'pending' }
    services.event('approval', grant)
    now = 1300
    services.event('approval', { ...grant, grantId: 'second' })
    now = 1500
    expect(await saved()).toEqual({ activeMs: 200, waitingMs: 300 })
    expect(await saved()).toEqual({ activeMs: 200, waitingMs: 300 })
    for (const payload of [{ runId: randomUUID() }, { podId: randomUUID() }, [], null]) {
      await expect(services.request('run.timing', payload, signal)).rejects.toThrow('no parameters')
    }
    now = 1600; services.event('approval', { ...grant, state: 'approved' })
    now = 1800; services.event('approval', { ...grant, grantId: 'second', state: 'approved' })
    now = 1900
    expect(await saved()).toEqual({ activeMs: 300, waitingMs: 600 })
    const aborted = AbortSignal.abort(new Error('Synthetic request cancelled'))
    await expect(services.request('run.timing', {}, aborted)).rejects.toThrow('cancelled')
    dispatcher.cancelPod(pod.id)
    await expect(saved()).rejects.toThrow('cancelled')
    return { status: 'cancelled', summary: 'Synthetic cancellation checked', completedInputIds: input.eventIds, gapIds: [] }
  })
  dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.view(pod.id).runs[0]?.state).toBe('cancelled')
  if (!saved) throw new Error('Script context was not exercised')
  await expect(saved()).rejects.toThrow()
  expect(store.db.prepare('SELECT * FROM effect_ledger').all()).toEqual([])
})
