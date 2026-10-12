// @vitest-environment node
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'

// The real worker entry on a damaged profile: it reports the classified failure and ends without loading the runtime,
// so no schedule, claim or external action can start.
const replies = vi.fn()
const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
let root = ''
afterAll(async () => { Reflect.deleteProperty(process, 'parentPort'); await rm(root, { recursive: true, force: true }) })

it('reports damaged storage and exits instead of starting automation', async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-entry-storage-')))
  new PodDatabase(root).close()
  const bytes = readFileSync(join(root, 'control.sqlite')); bytes.write('Not SQLite at al', 0, 'latin1'); writeFileSync(join(root, 'control.sqlite'), bytes)
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  Object.defineProperty(process, 'parentPort', { configurable: true, value: { postMessage: replies, on: vi.fn() } })
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
  await (await import('../../src/worker/entry')).started
  expect(replies).toHaveBeenCalledWith({ storage: expect.objectContaining({ reason: 'corrupt' }) })
  expect(replies).not.toHaveBeenCalledWith('ready')
  await vi.advanceTimersByTimeAsync(1000)
  expect(exit).toHaveBeenCalledWith(3)
  vi.useRealTimers()
})
