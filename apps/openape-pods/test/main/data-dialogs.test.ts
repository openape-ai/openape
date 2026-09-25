// @vitest-environment node
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { channels } from '../../src/contracts/ipc'
import { PodDatabase } from '../../src/worker/storage/database'
import { createBackup } from '../../src/worker/data/backup'
import { startMain } from './app-harness'
import type { MainHarness } from './app-harness'

// Formerly the packaged `data` E2E. Backup contents, deletion and restore of
// data are proven in test/data/*; here the main process: every destructive or
// restarting step waits for the owner's native confirmation, a restore works
// even when the worker refuses a newer database, and startup opens the
// profile the restore selected.
const podId = '00000000-0000-4000-8000-000000000001'
let main: MainHarness | undefined; const cleanups: string[] = []
afterEach(async () => { await main?.close(); main = undefined; for (const path of cleanups.splice(0)) await rm(path, { recursive: true, force: true }) })
const status = { usedBytes: 0, freeBytes: 1, limitBytes: 1, pendingDeletion: 0, busy: false, error: null }

it('deletes a local pod only after the owner confirms the native warning', async () => {
  main = await startMain()
  main.worker.data.mockResolvedValue(status)
  const command = { type: 'deletePod', podId, revision: 2, name: 'Recovery fixture' }
  main.dialog.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })
  await main.invoke(channels.data, command)
  expect(main.worker.data).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'deletePod' }))
  expect(main.dialog.showMessageBox.mock.calls[0]![1]).toMatchObject({ type: 'warning', message: expect.stringContaining('Recovery fixture'), cancelId: 0, defaultId: 0 })
  main.dialog.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
  await main.invoke(channels.data, command)
  expect(main.worker.data).toHaveBeenLastCalledWith(command)
})

it('writes a backup only into the folder the owner picked', async () => {
  main = await startMain()
  main.worker.data.mockResolvedValue(status)
  await main.invoke(channels.data, { type: 'backup' })
  expect(main.worker.data).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'backup' }))
  const exports = join(main.root, 'Exports Müller'); await mkdir(exports)
  main.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [exports] })
  await main.invoke(channels.data, { type: 'backup' })
  expect(main.worker.data).toHaveBeenLastCalledWith({ type: 'backup', parent: exports })
})

it('restores a backup although the worker refuses a newer database, selects the new profile and restarts', async () => {
  const source = await realpath(await mkdtemp(join(tmpdir(), 'pods-restore-source-'))); cleanups.push(source)
  const exports = await realpath(await mkdtemp(join(tmpdir(), 'pods-restore-exports-'))); cleanups.push(exports)
  const store = new PodDatabase(source); store.createPod({ name: 'Prior version' }); const backup = await createBackup(store, exports); store.close()
  main = await startMain()
  main.worker.publish({ state: 'error', pid: null, error: 'Database schema is newer than this app' })
  main.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [backup] })
  main.dialog.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })
  await main.invoke(channels.data, { type: 'restore' })
  expect(main.app.relaunch).not.toHaveBeenCalled()
  main.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [backup] })
  main.dialog.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
  await main.invoke(channels.data, { type: 'restore' })
  expect(main.worker.data).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'restore' }))
  const pointer = JSON.parse(await readFile(join(main.root, 'selected-profile.json'), 'utf8')) as { profile: string }
  expect(pointer.profile).toMatch(/^profiles\//)
  const restored = new PodDatabase(join(main.root, pointer.profile))
  try { expect(restored.listPods()[0]).toMatchObject({ name: 'Prior version', lifecycle: 'paused' }) }
  finally { restored.close() }
  expect(main.app.relaunch).toHaveBeenCalledOnce(); expect(main.app.quit).toHaveBeenCalled()
})

it('opens the profile a restore selected when the app starts', async () => {
  const profile = `profiles/${randomUUID()}`
  main = await startMain({}, async (root) => { await mkdir(join(root, profile), { recursive: true, mode: 0o700 }); await writeFile(join(root, 'selected-profile.json'), JSON.stringify({ profile })) })
  expect(main.paths.get('userData')).toBe(join(main.root, profile))
  expect(main.paths.get('sessionData')).toBe(join(main.root, profile, 'chromium'))
})
