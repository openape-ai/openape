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
import { recoveryHold, unresolvedOperation } from '../../src/worker/recovery/policy'
import type { AgentRuntime } from '../../src/worker/agent/executor'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
const stores: PodDatabase[] = []
afterEach(() => { vi.restoreAllMocks(); for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })

it('does not hold a standalone Pod after an interrupted legacy mail archive; the archive store fences its batch', async () => {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-legacy-archive-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const pod = store.createPod({ name: 'Legacy archive' })
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  vi.spyOn(resources, 'capture').mockResolvedValue({ id: randomUUID(), files: [] } as never)
  const mailArchive = vi.fn(async () => { throw new Error('Connection lost after the move request') })
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, _input, signal, hooks) => {
    await hooks.request('mail.archive', { operation: 'process' }, signal)
    throw new Error('must not reach')
  })
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime, { mailArchive })
  const runId = dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.view(pod.id).runs[0]?.state).toBe('failed')
  expect(dispatcher.view(pod.id, runId).events.find(event => event.type === 'recovery-boundary')?.data).toEqual({ kind: 'effect', operation: 'mail.archive' })
  expect(recoveryHold(store, pod.id, runId)).toBeNull()
  expect(unresolvedOperation(store, pod.id)).toBe(false)
})
