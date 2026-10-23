// @vitest-environment node
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { installExample } from '../../src/worker/runs/examples'
import { executeScript } from '../../src/worker/runs/runner'
import { setVolumeIdentityHelper } from '../../src/runtime/directories'
import type { AgentRuntime } from '../../src/worker/agent/executor'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { vi.mocked(executeScript).mockReset(); for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('starts no script when an assigned folder is on another volume, and runs it again once the volume matches', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'pods-volume-run-'))); roots.push(base)
  const volume = join(base, 'volume'); writeFileSync(volume, 'AAAAAAAA-1111-2222-3333-444444444444')
  const helper = join(base, 'helper.sh')
  writeFileSync(helper, `#!/bin/sh\nprintf '{"volume":"%s"}' "$(cat '${volume}')"\n`); chmodSync(helper, 0o755)
  setVolumeIdentityHelper(helper)
  const store = new PodDatabase(join(base, 'profile')); stores.push(store)
  const resources = new ResourceRegistry(store, () => {}); const pod = store.createPod({ name: 'Folder reader' })
  const folder = join(base, 'exchange'); mkdirSync(folder)
  await resources.assignDirectory(pod.id, folder, 'read', 0)
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  vi.spyOn(resources, 'capture').mockResolvedValue({ id: randomUUID(), files: [] } as never)
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input) => ({ status: 'completed', summary: JSON.stringify(input.directories), completedInputIds: input.eventIds, gapIds: [] }))
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime)
  writeFileSync(volume, 'BBBBBBBB-1111-2222-3333-444444444444')
  const refused = dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.runs.get(refused).state).toBe('failed')
  expect(JSON.stringify(dispatcher.runs.get(refused))).toContain('Assigned directory changed')
  expect(executeScript).not.toHaveBeenCalled()
  writeFileSync(volume, 'AAAAAAAA-1111-2222-3333-444444444444')
  const accepted = dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.runs.get(accepted).state).toBe('completed')
  expect(vi.mocked(executeScript).mock.calls[0]![3].directories).toEqual([{ path: folder, access: 'read' }])
})
