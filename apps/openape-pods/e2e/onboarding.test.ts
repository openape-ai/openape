import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { mkdtemp, realpath, rm, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { AuthProcess } from '../src/main/connections/process'

const require = createRequire(import.meta.url)
const executable: string = require('electron')

it('onboarding: the actual pinned authentication process accepts account reads and rejects model execution', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-auth-only-')))
  const home = join(root, 'home'); await mkdir(home, { mode: 0o700 })
  const runtime = { helper: resolve('dist/native/pods-helper'), executable: process.execPath, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [dirname(process.execPath)], environment: {}, binary: resolve('dist/vendor/codex'), catalog: resolve('dist/vendor/models.json'), manifest: resolve('dist/vendor/manifest.json'), sdkHost: resolve('dist/runtime/sdk-host.mjs') }
  const controller = new AbortController()
  const auth = await AuthProcess.start(runtime, root, runtime.binary, ['--strict-config', '-c', 'cli_auth_credentials_store="file"', 'app-server', '--stdio'], home, { HOME: home, CODEX_HOME: home, TMPDIR: home, PATH: '/usr/bin:/bin' }, controller.signal, () => {})
  try {
    await auth.request('initialize', { clientInfo: { name: 'pods_auth_test', version: '1' } }); auth.initialized()
    expect(await auth.request('account/read', { refreshToken: false })).toMatchObject({ account: null })
    await expect(auth.request('turn/start', { input: [] })).rejects.toThrow('cannot execute model')
    await expect(auth.request('command/exec', { command: ['touch', join(root, 'escaped')] })).rejects.toThrow('cannot execute model')
    await expect(readFile(join(root, 'escaped'))).rejects.toMatchObject({ code: 'ENOENT' })
  }
  finally { await auth.close(); await AuthProcess.recover(root, runtime.helper); await rm(root, { recursive: true, force: true }) }
})
it.each([false, true])('onboarding: empty setup, explicit continuation and no implicit activation (packaged=%s)', async (packaged) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-onboarding-')))
  const app = await electron.launch({ executablePath: packaged ? resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture') : executable, args: packaged ? [] : ['.'], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  try {
    const page = await app.firstWindow(); await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    await page.getByRole('button', { name: 'Connections & setup', exact: true }).click()
    await page.getByRole('heading', { name: 'Connections & setup', exact: true }).waitFor()
    expect(await page.evaluate(() => window.pods.onboarding({ type: 'list' }))).toMatchObject({ connections: [], complete: false, runtime: { ready: true, error: null } })
    expect(await page.getByRole('button', { name: 'Review and assign read-only mail' }).isDisabled()).toBe(true)
    await page.getByLabel('Connection', { exact: true }).selectOption('microsoft')
    await page.getByLabel('Expected account').fill('synthetic@example.invalid')
    await mkdir(resolve('.artifacts'), { recursive: true })
    await page.screenshot({ path: resolve(`.artifacts/onboarding-${packaged ? 'packaged' : 'desktop'}.png`) })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/onboarding-narrow-dark.png') })
    await page.getByRole('button', { name: 'Continue to workspace' }).click()
    expect((await page.evaluate(() => window.pods.onboarding({ type: 'list' })))).toMatchObject({ complete: true, connections: [] })
    expect((await page.evaluate(() => window.pods.workspace({ type: 'list' })))).toEqual({ pods: [] })
    expect(await page.evaluate(async () => {
      try { await window.pods.onboarding({ type: 'save', token: 'not-allowed' } as never); return 'allowed' }
      catch { return 'denied' }
    })).toBe('denied')
  }
  finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
