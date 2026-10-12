// @vitest-environment node
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { storageReadinessMs } from '../../src/contracts/storage'
import type { WorkerStatus } from '../../src/contracts/ipc'

const fork = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ utilityProcess: { fork }, safeStorage: {}, app: { getPath: () => '/nonexistent' }, shell: { openExternal: vi.fn(async () => {}) } }))
vi.mock('../../src/main/support', () => ({ assertPilotRuntime: () => {} }))

class Child extends EventEmitter {
  pid = 4242
  stderr = new EventEmitter()
  postMessage = vi.fn()
  kill = vi.fn(() => { this.emit('exit', 15) })
}
const roots: string[] = []
afterEach(() => { vi.useRealTimers(); fork.mockReset(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
async function started() {
  const { FixtureWorker } = await import('../../src/main/worker')
  const published: WorkerStatus[] = []
  const worker = new FixtureWorker(status => published.push(structuredClone(status)))
  const children: Child[] = []
  fork.mockImplementation(() => { const child = new Child(); children.push(child); return child })
  const root = mkdtempSync(join(tmpdir(), 'pods-worker-storage-')); roots.push(root)
  worker.start(root, root)
  return { worker, published, children }
}

it('shows a classified recovery instead of an error, and never restarts the worker by itself', async () => {
  vi.useFakeTimers()
  const { published, children } = await started()
  children[0]!.emit('message', { storage: { reason: 'corrupt', message: 'Database integrity check failed', at: 1 } })
  children[0]!.emit('exit', 3)
  expect(published.at(-1)).toMatchObject({ state: 'recovery', storage: { reason: 'corrupt' } })
  await vi.advanceTimersByTimeAsync(storageReadinessMs * 4)
  expect(fork).toHaveBeenCalledTimes(1)
})

it('reports a storage open that does not finish in time and opens again only on request', async () => {
  vi.useFakeTimers()
  const { worker, published, children } = await started()
  await vi.advanceTimersByTimeAsync(storageReadinessMs - 1)
  expect(published.some(status => status.state === 'recovery')).toBe(false)
  await vi.advanceTimersByTimeAsync(2)
  expect(published.at(-1)).toMatchObject({ state: 'recovery', storage: { reason: 'timeout' } })
  await worker.retryStorage()
  expect(children[0]!.kill).toHaveBeenCalled()
  expect(fork).toHaveBeenCalledTimes(2)
})

it('passes the automatic backup directory beside the profile base to the worker', async () => {
  await started()
  const environment = fork.mock.calls[0]![2].env as Record<string, string>
  expect(environment.PODS_BACKUP_DIRECTORY).toMatch(/ Backups$/)
  expect(environment.PODS_BACKUP_DIRECTORY.startsWith(`${fork.mock.calls[0]![2].cwd as string}/`)).toBe(false)
})
