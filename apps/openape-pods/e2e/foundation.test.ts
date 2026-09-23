import { _electron as electron } from 'playwright'
import type { ElectronApplication } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

import { fixtureShellIdentity } from './fixtures/shell-identity'

const identities: Awaited<ReturnType<typeof fixtureShellIdentity>>[] = []
const require = createRequire(import.meta.url)
const executable: string = require('electron')

const active: { app: ElectronApplication, root: string, process: ChildProcess }[] = []
const artifacts = resolve('.artifacts')
function fixtureEnv(root: string) { return { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, PODS_UNASSIGNED_SECRET: 'synthetic-canary', NODE_ENV: 'test' } }
async function launch(packaged = false) {
  if (process.platform !== 'darwin') throw new Error('Electron foundation acceptance requires the macOS runner')
  const root = await mkdtemp(join(tmpdir(), 'pods-e2e-'))
  const binary = packaged ? resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture') : executable
  const app = await electron.launch({ executablePath: binary, args: packaged ? [] : ['.'], cwd: resolve('.'), env: { ...fixtureEnv(root), OPENAPE_PODS_ISSUE_REPORTING_ENABLED: '0' }, timeout: 20000 })
  active.push({ app, root, process: app.process() })
  const page = await app.firstWindow()
  await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state, { timeout: 20000 }).toBe('ready')
  expect((await page.evaluate(() => window.pods.getStatus())).worker).toMatchObject({ state: 'ready', error: null })
  return { app, page, root, binary }
}
afterEach(async () => {
  for (const identity of identities.splice(0)) await identity.close()
  for (const { app, root, process: child } of active.splice(0)) { if (child.exitCode === null && child.signalCode === null) await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})
// Native menus, problem reporting and German dialogs are tested against the
// unchanged main process in test/main/app.test.ts.
describe('foundation', () => {
  it('packaged: embeds the approved macOS icon referenced by the bundle', async () => {
    const contents = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents')
    const icon = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIconFile', join(contents, 'Info.plist')], { encoding: 'utf8' }).trim()
    expect(icon).toBe('icon.icns')
    expect(await readFile(join(contents, 'Resources', icon))).toEqual(await readFile(resolve('build/openape-pods.icns')))
  })
  it('resources: reviews, snapshots and revokes a reference through the packaged owner window', async () => {
    const { app, page, root } = await launch(true)
    const pod = (await page.evaluate(() => window.pods.workspace({ type: 'create', name: 'Reference pod' }))).pods[0]!
    const source = join(root, 'synthetic-reference.txt'); await writeFile(source, 'SYNTHETIC_REFERENCE')
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    }, source)
    await page.getByRole('tab', { name: 'Permissions', exact: true }).click()
    await page.evaluate(podId => window.pods.resources({ type: 'pickReference', podId }), pod.id)
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    await page.getByRole('tab', { name: 'Permissions', exact: true }).click()
    await page.getByText('synthetic-reference.txt', { exact: true }).waitFor()
    const snapshot = await page.evaluate(podId => window.pods.resources({ type: 'snapshot', podId }), pod.id)
    expect(snapshot.snapshot?.files).toHaveLength(1)
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, 'resources-packaged.png') })
    const before = await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), pod.id)
    expect(before.resources).toHaveLength(1)
    expect(await page.evaluate(async (podId) => {
      try { await window.pods.resources({ type: 'assignReference', podId, name: 'Unapproved', path: '/unassigned' } as never); return 'allowed' }
      catch { return 'denied' }
    }, pod.id)).toBe('denied')
    await page.getByRole('button', { name: /synthetic-reference.txt/ }).click()
    await page.getByRole('button', { name: 'Remove directory access' }).click()
    await expect.poll(() => page.getByText('synthetic-reference.txt', { exact: true }).count()).toBe(0)
    expect(await readFile(source, 'utf8')).toBe('SYNTHETIC_REFERENCE')
    const after = await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), pod.id)
    expect(after.epoch).toBe(before.epoch + 1)
  })
  it('manual runs: executes the pinned script in the packaged app and displays durable events', async () => {
    const { app, page, root } = await launch(true)
    const pod = (await page.evaluate(() => window.pods.workspace({ type: 'create', name: 'Local example' }))).pods[0]!
    const identity = await fixtureShellIdentity(root); identities.push(identity); await identity.encrypt(app, true)
    await page.getByRole('tab', { name: 'History', exact: true }).click()
    await page.evaluate(podId => window.pods.runs({ type: 'installExample', podId, variant: 'deterministic' }), pod.id)
    await page.getByRole('button', { name: 'Run now', exact: true }).click()
    await page.getByText('Local example completed (1)', { exact: true }).waitFor()
    await page.getByText('Technical details', { exact: true }).click()
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, 'runs-packaged.png') })
    const view = await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), pod.id)
    expect(view.runs[0]).toMatchObject({ state: 'completed', checkpointRevision: 1, error: null })
  })
  it('boundary: denies renderer Node, external network/navigation, popups and foreign-frame IPC', async () => {
    const { app, page } = await launch()
    expect(await page.evaluate(() => ({ node: typeof (globalThis as Record<string, unknown>).require, process: typeof (globalThis as Record<string, unknown>).process, bridge: Object.keys(window.pods).sort() }))).toEqual({ node: 'undefined', process: 'undefined', bridge: ['chats', 'codex', 'data', 'details', 'getStatus', 'language', 'master', 'onStatus', 'onboarding', 'packages', 'programs', 'resources', 'runs', 'scheduling', 'scripts', 'workflows', 'workspace'] })
    expect(await page.evaluate(async () => {
      try { await fetch('https://unassigned.invalid/'); return 'allowed' }
      catch { return 'denied' }
    })).toBe('denied')
    await page.evaluate(() => { window.open('https://unassigned.invalid/'); window.location.href = 'https://unassigned.invalid/' })
    expect(page.url()).toBe('pods://app/index.html')
    expect(app.windows()).toHaveLength(1)
    const result = await app.evaluate(async ({ BrowserWindow, app }) => {
      const other = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: `${app.getAppPath()}/dist/preload/index.cjs` } })
      try {
        await other.loadURL('pods://app/index.html')
        return await other.webContents.executeJavaScript('(async () => { const results = []; for (const request of [() => window.pods.master({type:"list"}), () => window.pods.language({type:"set", language:"de"}), () => window.pods.workflows({type:"list"}), () => window.pods.chats({type:"list"})]) { try { await request(); results.push("allowed") } catch { results.push("denied") } } return results })()')
      }
      finally { other.destroy() }
    })
    expect(result).toEqual(['denied', 'denied', 'denied', 'denied'])
    const status = await page.evaluate(() => window.pods.getStatus())
    expect(status.executionEnabled).toBe(true)
    expect(status.worker.pid).toBeGreaterThan(0)
    const environment = (pid: number) => execFileSync('/bin/ps', ['eww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
    expect(environment(app.process().pid as number)).toContain('PODS_UNASSIGNED_SECRET=synthetic-canary')
    expect(environment(status.worker.pid as number)).not.toContain('PODS_UNASSIGNED_SECRET')
  })
  it('keeps the worker when closing the window, reopens a single instance and quits cleanly', async () => {
    const { app, page, root, binary } = await launch()
    const before = await page.evaluate(() => window.pods.getStatus())
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
    process.kill(before.worker.pid as number, 0)
    const second = spawn(binary, ['.'], { cwd: resolve('.'), env: fixtureEnv(root), stdio: 'ignore' })
    const exit = await new Promise<number | null>((resolveExit, reject) => {
      const timer = setTimeout(() => { second.kill('SIGKILL'); reject(new Error('Second instance did not exit')) }, 8000)
      second.once('error', (error) => { clearTimeout(timer); reject(error) })
      second.once('exit', (code) => { clearTimeout(timer); resolveExit(code) })
    })
    expect(exit).toBe(0)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
    expect((await page.evaluate(() => window.pods.getStatus())).worker.pid).toBe(before.worker.pid)
    expect(app.windows()).toHaveLength(1)
    await app.close()
    await expect.poll(() => {
      try { process.kill(before.worker.pid as number, 0); return 'alive' }
      catch { return 'gone' }
    }).toBe('gone')
  })
  it('shows worker failure after the worker process is killed', async () => {
    const { page } = await launch()
    await mkdir(artifacts, { recursive: true })
    const status = await page.evaluate(() => window.pods.getStatus())
    process.kill(status.worker.pid as number, 'SIGKILL')
    await page.getByRole('alert').filter({ hasText: 'Quit and reopen Pods' }).waitFor()
    expect(await page.getByRole('status').textContent()).toBe('Needs attention')
    await page.screenshot({ path: join(artifacts, 'foundation-worker-error.png') })
  })
  it('packaged: starts from the app bundle without system Node and preserves the renderer boundary', async () => {
    const { app, page } = await launch(true)
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    const status = await page.evaluate(() => window.pods.getStatus())
    expect(status.runtime).toEqual({ electron: '40.9.3', node: '24.14.1' })
    expect(await page.evaluate(() => typeof (globalThis as Record<string, unknown>).require)).toBe('undefined')
    expect(await page.getByRole('heading', { name: 'No pods yet' }).isVisible()).toBe(true)
  })
})
