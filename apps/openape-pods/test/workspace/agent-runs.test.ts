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
import { executeAgent } from '../../src/worker/agent/executor'
import type { AgentRuntime } from '../../src/worker/agent/executor'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
vi.mock('../../src/worker/agent/executor', () => ({ executeAgent: vi.fn() }))
const stores: PodDatabase[] = []
afterEach(() => { vi.restoreAllMocks(); for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })

it('bounds a standalone run to 50 agent calls, as for network members', async () => {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-agent-run-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const pod = store.createPod({ name: 'Agent run' })
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  vi.spyOn(resources, 'capture').mockResolvedValue({ id: randomUUID(), files: [] } as never)
  vi.mocked(executeAgent).mockResolvedValue({ threadId: 'synthetic', response: 'done' })
  let refusal = ''
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    for (let call = 0; call < 50; call++) await hooks.request('agent.run', { prompt: 'Synthetic task', tools: [] }, signal)
    await hooks.request('agent.run', { prompt: 'Synthetic task', tools: [] }, signal).catch((error: Error) => { refusal = error.message })
    return { status: 'completed', summary: 'Agent calls bounded', completedInputIds: input.eventIds, gapIds: [] }
  })
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime, { provider: async () => new Response('{}') })
  dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.view(pod.id).runs[0]?.state).toBe('completed')
  expect(executeAgent).toHaveBeenCalledTimes(50)
  expect(refusal).toBe('A run can start at most 50 agent calls')
})
