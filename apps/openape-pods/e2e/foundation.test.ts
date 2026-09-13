import { _electron as electron } from 'playwright'
import type { ElectronApplication } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const executable: string = require('electron')

const active: { app: ElectronApplication, root: string, process: ChildProcess }[] = []
const artifacts = resolve('.artifacts')
function fixtureEnv(root: string) { return { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, PODS_UNASSIGNED_SECRET: 'synthetic-canary', NODE_ENV: 'test' } }
async function launch(packaged = false) {
  if (process.platform !== 'darwin') throw new Error('Electron foundation acceptance requires the macOS runner')
  const root = await mkdtemp(join(tmpdir(), 'pods-e2e-'))
  const binary = packaged ? resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture') : executable
  const app = await electron.launch({ executablePath: binary, args: packaged ? [] : ['.'], cwd: resolve('.'), env: fixtureEnv(root), timeout: 20000 })
  active.push({ app, root, process: app.process() })
  const page = await app.firstWindow()
  await page.waitForFunction(async () => (await window.pods.getStatus()).worker.state !== 'starting')
  expect((await page.evaluate(() => window.pods.getStatus())).worker).toMatchObject({ state: 'ready', error: null })
  return { app, page, root, binary }
}
afterEach(async () => {
  for (const { app, root, process: child } of active.splice(0)) { if (child.exitCode === null && child.signalCode === null) await app.close(); await rm(root, { recursive: true, force: true }) }
})
describe('foundation', () => {
  it.each([false, true])('resources: reviews, snapshots and revokes a reference through the owner window (packaged=%s)', async (packaged) => {
    const { app, page, root } = await launch(packaged)
    const pod = (await page.evaluate(() => window.pods.workspace({ type: 'create', name: 'Reference pod', assignment: 'Read the assigned synthetic reference only.' }))).pods[0]!
    const source = join(root, 'synthetic-reference.txt'); await writeFile(source, 'SYNTHETIC_REFERENCE')
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    }, source)
    await page.getByRole('tab', { name: 'Resources', exact: true }).click()
    await page.getByRole('button', { name: 'Assign reference file' }).click()
    await page.getByText('synthetic-reference.txt', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Preview next snapshot' }).click()
    await page.getByRole('heading', { name: 'Snapshot ready' }).waitFor()
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, packaged ? 'resources-packaged.png' : 'resources-reference.png') })
    const before = await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), pod.id)
    expect(before.resources).toHaveLength(1)
    expect(await page.evaluate(async (podId) => {
      try { await window.pods.resources({ type: 'assignReference', podId, name: 'Unapproved', path: '/unassigned' } as never); return 'allowed' }
      catch { return 'denied' }
    }, pod.id)).toBe('denied')
    await page.getByRole('button', { name: 'Revoke access' }).click()
    await page.getByText('revoked · revision 2', { exact: true }).waitFor()
    expect(await readFile(source, 'utf8')).toBe('SYNTHETIC_REFERENCE')
    const after = await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), pod.id)
    expect(after.epoch).toBe(before.epoch + 1)
  })
  it.each([false, true])('manual runs: executes the pinned script and displays durable events (packaged=%s)', async (packaged) => {
    const { page } = await launch(packaged)
    const pod = (await page.evaluate(() => window.pods.workspace({ type: 'create', name: 'Local example', assignment: 'Run synthetic examples only.' }))).pods[0]!
    await page.getByRole('tab', { name: 'Runs', exact: true }).click()
    await page.getByRole('button', { name: 'Use local example', exact: true }).click()
    await page.getByRole('button', { name: 'Start run', exact: true }).click()
    await page.getByRole('button', { name: 'Local example completed (1)', exact: true }).waitFor()
    await page.getByText('Persisted events', { exact: true }).click()
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, packaged ? 'runs-packaged.png' : 'runs-manual.png') })
    const view = await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), pod.id)
    expect(view.runs[0]).toMatchObject({ state: 'completed', checkpointRevision: 1, error: null })
  })
  it('scheduling: persists a disabled daily schedule and an explicit concurrency limit', async () => {
    const { page } = await launch()
    const pod = (await page.evaluate(() => window.pods.workspace({ type: 'create', name: 'Scheduled example', assignment: 'Synthetic local scripts only.' }))).pods[0]!
    await page.getByRole('tab', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Scheduled example', exact: true }).click()
    await page.getByLabel('Repeat', { exact: true }).selectOption('daily')
    await page.getByLabel('Local time', { exact: true }).fill('08:30')
    await page.getByRole('button', { name: 'Save schedule', exact: true }).click()
    await page.getByText('Saved on this Mac.', { exact: true }).waitFor()
    expect((await page.evaluate(podId => window.pods.scheduling({ type: 'list', podId }), pod.id)).enabled).toBe(false)
    await page.getByLabel('Concurrent pods on this Mac').fill('3')
    await page.getByRole('button', { name: 'Save concurrency limit' }).click()
    await expect.poll(async () => (await page.evaluate(podId => window.pods.scheduling({ type: 'list', podId }), pod.id)).concurrency).toBe(3)
    await mkdir(artifacts, { recursive: true })
    await page.getByRole('heading', { name: 'Schedule and limits' }).scrollIntoViewIfNeeded()
    await page.locator('.schedule-panel').screenshot({ path: join(artifacts, 'schedule-settings.png') })
    expect((await page.evaluate(() => window.pods.workspace({ type: 'list' }))).pods[0]!.lifecycle).toBe('paused')
  })
  it('storage: saves a pod assignment in the worker and reopens it after app restart', async () => {
    const { app, page, root, binary } = await launch()
    await page.getByRole('tab', { name: 'Settings', exact: true }).click()
    await page.getByLabel('Pod name').fill('Fixture orders')
    await page.getByLabel('Assignment', { exact: true }).fill('Read synthetic order evidence only.')
    await page.getByRole('button', { name: 'Save pod', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Saved locally' }).waitFor()
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, 'storage-settings.png') })
    const first = await page.evaluate(() => window.pods.workspace({ type: 'list' }))
    expect(first.pods).toHaveLength(1); expect(first.pods[0]!.activeScript).toBeNull()
    expect(await page.evaluate(async () => {
      try { await window.pods.workspace({ type: 'create', name: 'bad', assignment: 'bad', credential: 'unassigned' } as never); return 'allowed' }
      catch { return 'denied' }
    })).toBe('denied')
    await app.close()
    const next = await electron.launch({ executablePath: binary, args: ['.'], cwd: resolve('.'), env: fixtureEnv(root) })
    active.push({ app: next, root, process: next.process() })
    const reopened = await next.firstWindow()
    await reopened.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    await reopened.getByRole('tab', { name: 'Settings', exact: true }).click()
    await reopened.getByRole('button', { name: 'Fixture orders', exact: true }).click()
    expect(await reopened.getByLabel('Assignment', { exact: true }).inputValue()).toBe('Read synthetic order evidence only.')
    expect(await reopened.evaluate(() => window.pods.workspace({ type: 'list' }))).toEqual(first)
  })
  it('boundary: denies renderer Node, external network/navigation, popups and foreign-frame IPC', async () => {
    const { app, page } = await launch()
    expect(await page.evaluate(() => ({ node: typeof (globalThis as Record<string, unknown>).require, process: typeof (globalThis as Record<string, unknown>).process, bridge: Object.keys(window.pods).sort() }))).toEqual({ node: 'undefined', process: 'undefined', bridge: ['getStatus', 'onStatus', 'resources', 'runs', 'scheduling', 'workspace'] })
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
        return await other.webContents.executeJavaScript('window.pods.getStatus().then(() => "allowed", () => "denied")')
      }
      finally { other.destroy() }
    })
    expect(result).toBe('denied')
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
  it('shows worker failure and supports keyboard navigation with light/dark layout', async () => {
    const { app, page } = await launch()
    await mkdir(artifacts, { recursive: true })
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme })
      await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark')
      await page.evaluate(() => new Promise<void>(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))))
      await page.screenshot({ path: join(artifacts, `foundation-${theme}.png`) })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(880, 640))
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('footer')!.getBoundingClientRect().bottom <= innerHeight + 1)
    expect(await fits()).toBe(true)
    await page.screenshot({ path: join(artifacts, 'foundation-compact.png') })
    const originalHeight = await page.evaluate(() => {
      const rule = Array.from(document.styleSheets[0].cssRules).find(rule => rule instanceof CSSStyleRule && rule.selectorText === '.workspace') as CSSStyleRule
      const height = rule.style.height; rule.style.removeProperty('height'); return height
    })
    expect(await fits()).toBe(false)
    await page.evaluate((height) => {
      const rule = Array.from(document.styleSheets[0].cssRules).find(rule => rule instanceof CSSStyleRule && rule.selectorText === '.workspace') as CSSStyleRule
      rule.style.height = height
    }, originalHeight)
    expect(await fits()).toBe(true)
    await page.getByRole('tab', { name: 'Overview', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('tabpanel').filter({ hasText: 'Supported findings' }).waitFor()
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
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
    expect(await page.getByRole('button', { name: 'Run once' }).isDisabled()).toBe(false)
  })
})
