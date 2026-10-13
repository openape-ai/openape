// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { MasterControl } from '../../src/worker/master/control'
import { executeScript } from '../../src/worker/runs/runner'
import type { AgentRuntime } from '../../src/worker/agent/executor'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
const stores: PodDatabase[] = []
afterEach(() => { vi.mocked(executeScript).mockReset(); for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })

async function drafted() {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-validation-'))); stores.push(store)
  const manifest = join(store.root, 'runtime.json'); writeFileSync(manifest, JSON.stringify({ dependencyLockHash: 'a'.repeat(64) }))
  const runtime = { manifest } as AgentRuntime
  const resources = new ResourceRegistry(store, () => {}); const dispatcher = new RunDispatcher(store, resources, runtime)
  const master = new MasterControl(store, resources, dispatcher, new Scheduler(store, dispatcher), runtime)
  const pod = store.createPod({ name: 'Input checker' })
  const draft = await master.execute(randomUUID(), { action: 'draft', podId: pod.id, revision: pod.revision, draftId: null, draftRevision: 0, code: 'export async function run() {}', capabilities: [] }, new AbortController().signal) as { draftId: string, draftRevision: number }
  const validate = () => master.execute(randomUUID(), { action: 'validate', podId: pod.id, revision: pod.revision, draftId: draft.draftId, draftRevision: draft.draftRevision }, new AbortController().signal) as Promise<{ hash: string, evidence: string, status: string }>
  return { validate }
}

it('accepts a well-formed failed result with its reason and records the status in the evidence', async () => {
  const { validate } = await drafted()
  vi.mocked(executeScript).mockResolvedValue({ status: 'failed', summary: 'Pending check returned no count', completedInputIds: [], gapIds: [] })
  const result = await validate()
  expect(result.status).toBe('failed')
  expect(JSON.parse(result.evidence)).toMatchObject({ kind: 'native-synthetic-contract', result: 'failed', summary: 'Pending check returned no count' })
})

it('rejects an unsuccessful result after a refused service request, a thrown script and an uncommitted gap', async () => {
  const { validate } = await drafted()
  vi.mocked(executeScript).mockImplementation(async (_runtime, _root, _artifact, _input, _signal, services) => {
    // The script swallows the refusal and reports a failure of its own.
    try { await services.request('tools.invoke', { application: 'unassigned', argv: [] }, new AbortController().signal) }
    catch {}
    return { status: 'failed', summary: 'Could not read the mailbox', completedInputIds: [], gapIds: [] }
  })
  await expect(validate()).rejects.toThrow('Draft returned failed after validation refused a service request')
  vi.mocked(executeScript).mockRejectedValue(new Error('Script exceeded its time limit'))
  await expect(validate()).rejects.toThrow('Script exceeded its time limit')
  vi.mocked(executeScript).mockResolvedValue({ status: 'completedWithGaps', summary: 'Gap without a claim', completedInputIds: [], gapIds: ['missing'] })
  await expect(validate()).rejects.toThrow('uncommitted validation gap')
})

// Issue 1469: validation accepted a program approval request that the live run refused.
it('refuses a program approval request for an application the script does not declare', async () => {
  const { validate } = await drafted()
  vi.mocked(executeScript).mockImplementation(async (_runtime, _root, _artifact, _input, _signal, services) => {
    await services.request('approvals.request', { action: 'program.run', payload: { application: 'git', argv: ['push', 'origin', 'main'] } }, new AbortController().signal)
    return { status: 'completed', summary: 'Asked', completedInputIds: [], gapIds: [] }
  })
  await expect(validate()).rejects.toThrow('Application is not declared and assigned to this script')
})
