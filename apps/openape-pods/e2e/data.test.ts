import { _electron as electron } from 'playwright'
import type { ElectronApplication } from 'playwright'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fixtureDirectory } from '../src/main/fixture'
import { PodDatabase } from '../src/worker/storage/database'
import { createBackup } from '../src/worker/data/backup'
import { expect, it } from 'vitest'

import { fixtureShellIdentity } from './fixtures/shell-identity'

const executable: string = createRequire(import.meta.url)('electron')
it.each([false, true])('data: backs up, confirms deletion, restores into a fresh paused profile and restarts (packaged=%s)', async (packaged) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'Pods Müller recovery '))); const root = join(base, 'profile'); const exports = join(base, 'exports'); await mkdir(root, { mode: 0o700 }); await mkdir(exports)
  const launch = () => electron.launch({ executablePath: packaged ? resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture') : executable, args: packaged ? [] : ['.'], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  let identity: Awaited<ReturnType<typeof fixtureShellIdentity>> | undefined
  let app: ElectronApplication = await launch()
  try {
    let page = await app.firstWindow(); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    const pod = (await page.evaluate(() => window.pods.workspace({ type: 'create', name: 'Recovery fixture' }))).pods[0]
    identity = await fixtureShellIdentity(root); await identity.encrypt(app, true)
    const workspace = join(root, 'pods', pod.id, 'workspace'); await mkdir(workspace, { recursive: true }); await writeFile(join(workspace, 'notes.txt'), 'SYNTHETIC_DURABLE_WORKSPACE')
    await page.getByRole('tab', { name: 'History', exact: true }).click(); await page.getByRole('button', { name: 'Use local example', exact: true }).click(); await page.getByRole('button', { name: 'Start run', exact: true }).click()
    await page.getByRole('button', { name: 'Local example completed (1)', exact: true }).waitFor()
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, exports)
    await page.getByRole('button', { name: 'App settings', exact: true }).click(); await page.getByRole('button', { name: 'Data & backups', exact: true }).click(); await page.getByRole('heading', { name: 'Data & backups', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Export backup…', exact: true }).click()
    await page.locator('.result').waitFor(); const view = await page.evaluate(() => window.pods.data({ type: 'status' })); const backup = view.result!.path
    expect(JSON.parse(await readFile(join(backup, 'backup.json'), 'utf8')).format).toBe('openape-pods-backup')
    await mkdir(resolve('.artifacts'), { recursive: true }); await page.screenshot({ path: resolve(`.artifacts/data-${packaged ? 'packaged' : 'desktop'}.png`) })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: resolve('.artifacts/data-narrow-dark.png') })
    await page.locator('.pod-button').filter({ hasText: 'Recovery fixture' }).click(); await page.getByRole('tab', { name: 'Settings', exact: true }).click(); await page.getByText('More options', { exact: true }).click(); await page.getByRole('button', { name: 'Archive pod', exact: true }).click()
    await page.getByRole('button', { name: 'Delete local pod…', exact: true }).waitFor()
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
    await page.getByRole('button', { name: 'Delete local pod…', exact: true }).click()
    expect((await page.evaluate(() => window.pods.workspace({ type: 'list' }))).pods).toHaveLength(1)
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
    await page.getByRole('button', { name: 'Delete local pod…', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.pods.workspace({ type: 'list' }))).pods.length).toBe(0)
    await expect(readFile(join(workspace, 'notes.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    await app.evaluate(({ dialog, app }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
      const state = globalThis as unknown as { restoreQuit: typeof app.quit }; state.restoreQuit = app.quit.bind(app); app.quit = () => {}; app.relaunch = () => {}
    }, backup)
    await page.evaluate(() => window.pods.data({ type: 'restore' }))
    const pointer = JSON.parse(await readFile(join(root, 'selected-profile.json'), 'utf8')); expect(pointer.profile).toMatch(/^profiles\//)
    await app.evaluate(({ app }) => { app.quit = (globalThis as unknown as { restoreQuit: typeof app.quit }).restoreQuit })
    await app.close(); app = await launch(); page = await app.firstWindow()
    await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    const restored = (await page.evaluate(() => window.pods.workspace({ type: 'list' }))).pods[0]
    expect(restored).toMatchObject({ id: pod.id, name: pod.name, lifecycle: 'paused' })
    expect((await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), pod.id)).runs[0].state).toBe('completed')
    expect((await page.evaluate(podId => window.pods.scheduling({ type: 'list', podId }), pod.id)).enabled).toBe(false)
    expect(await readFile(join(root, pointer.profile, 'pods', pod.id, 'workspace/notes.txt'), 'utf8')).toBe('SYNTHETIC_DURABLE_WORKSPACE')
  }
  finally { await app.close(); await identity?.close(); await rm(base, { recursive: true, force: true }) }
})

it('data: restores a compatible backup when a newer database blocks normal startup', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'Pods previous version '))); const root = join(base, 'profile'); const exports = join(base, 'exports'); await mkdir(root, { mode: 0o700 }); await mkdir(exports); fixtureDirectory(root)
  const store = new PodDatabase(root); store.createPod({ name: 'Prior version' }); const backup = await createBackup(store, exports); store.db.exec('PRAGMA user_version=999'); store.close()
  const app = await electron.launch({ executablePath: executable, args: ['.'], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  try {
    const page = await app.firstWindow(); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('error')
    await app.evaluate(({ dialog, app }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
      const state = globalThis as unknown as { restoreQuit: typeof app.quit }; state.restoreQuit = app.quit.bind(app); app.quit = () => {}; app.relaunch = () => {}
    }, backup)
    await page.getByRole('button', { name: 'App settings', exact: true }).click(); await page.getByRole('button', { name: 'Data & backups', exact: true }).click()
    await page.getByRole('button', { name: 'Restore backup and restart…', exact: true }).click()
    await expect.poll(async () => {
      try { return JSON.parse(await readFile(join(root, 'selected-profile.json'), 'utf8')).profile as string }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error }
    }).toMatch(/^profiles\//)
    const pointer = JSON.parse(await readFile(join(root, 'selected-profile.json'), 'utf8')); const restored = new PodDatabase(join(root, pointer.profile))
    try { expect(restored.listPods()[0]).toMatchObject({ name: 'Prior version', lifecycle: 'paused' }) }
    finally { restored.close() }
    await app.evaluate(({ app }) => { app.quit = (globalThis as unknown as { restoreQuit: typeof app.quit }).restoreQuit })
  }
  finally { await app.close(); await rm(base, { recursive: true, force: true }) }
})
