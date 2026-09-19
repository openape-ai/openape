import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { mkdtemp, realpath, rm, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PodDatabase } from '../src/worker/storage/database'
import { SetupControl } from '../src/worker/onboarding/control'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { fixtureDirectory } from '../src/main/fixture'
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
    const page = await app.firstWindow(); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await page.getByRole('button', { name: 'App settings', exact: true }).click(); await page.getByRole('button', { name: 'Your accounts', exact: true }).click()
    await page.getByRole('heading', { name: 'Your accounts', exact: true }).waitFor()
    expect(await page.evaluate(() => window.pods.onboarding({ type: 'list' }))).toMatchObject({ connections: [], complete: false, runtime: { ready: true, error: null } })
    expect(await page.getByLabel('Connection', { exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['chatgpt', 'openape'])
    await page.getByLabel('Connection', { exact: true }).selectOption('openape')
    await page.getByRole('button', { name: 'OpenApe account', exact: true }).waitFor()
    await page.getByText('Choose your account', { exact: true }).waitFor()
    await page.getByLabel('Expected account').fill('synthetic@example.invalid')
    await mkdir(resolve('.artifacts'), { recursive: true })
    await page.screenshot({ path: resolve(`.artifacts/onboarding-${packaged ? 'packaged' : 'desktop'}.png`) })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/onboarding-narrow-dark.png') })
    await page.getByRole('button', { name: 'Continue to workspace' }).click()
    expect((await page.evaluate(() => window.pods.onboarding({ type: 'list' })))).toMatchObject({ complete: true, connections: [] })
    expect((await page.evaluate(() => window.pods.workspace({ type: 'list' })))).toEqual({ pods: [], organization: { revision: 1, groups: [] } })
    expect(await page.evaluate(async () => {
      try { await window.pods.onboarding({ type: 'save', token: 'not-allowed' } as never); return 'allowed' }
      catch { return 'denied' }
    })).toBe('denied')
  }
  finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

it('onboarding: central account selection persists without moving existing pods (packaged)', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-account-ui-'))); fixtureDirectory(root)
  const store = new PodDatabase(root); const pod = store.createPod({ name: 'Existing invoice pod' })
  const setup = new SetupControl(store, new ResourceRegistry(store, () => {}))
  const first = randomUUID(); const second = randomUUID()
  const identity = { connectionId: randomUUID(), podId: pod.id, issuer: 'https://pods.example.invalid', decisionIssuer: 'https://identity.example.invalid', owner: 'original@example.invalid', subject: 'invoice-agent@pods.example.invalid', keyId: 'synthetic-key', brokerConnectionId: randomUUID() }
  const metadata = { issuer: identity.decisionIssuer, broker: { issuer: identity.issuer, domain: 'pods.example.invalid', connectionId: identity.brokerConnectionId }, pods: { [pod.id]: { connectionId: identity.connectionId, prepared: true, identity } } }
  for (const [id, account] of [[first, 'original@example.invalid'], [second, 'new-default@example.invalid']]) setup.execute({ type: 'save', connection: { id, provider: 'openape', account, state: 'ready', error: null }, metadata: id === first ? metadata : { issuer: metadata.issuer } })
  store.close()
  const launch = () => electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await page.getByRole('button', { name: 'OpenApe account', exact: true }).click()
    await page.getByRole('heading', { name: 'Your accounts', exact: true }).waitFor()
    const connections = page.locator('.setup-connection')
    await connections.filter({ hasText: 'original@example.invalid' }).getByRole('button', { name: 'Use for new pods', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.pods.onboarding({ type: 'list' }))).defaultOwner).toBe(first)
    await connections.filter({ hasText: 'new-default@example.invalid' }).getByRole('button', { name: 'Use for new pods', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.pods.onboarding({ type: 'list' }))).defaultOwner).toBe(second)
    await expect.poll(() => page.getByRole('button', { name: 'OpenApe account', exact: true }).textContent()).toContain('new-default@example.invalid')
    await mkdir(resolve('.artifacts'), { recursive: true })
    await page.screenshot({ path: resolve('.artifacts/central-account.png') })
    expect(await page.getByRole('button', { name: 'Allow requests from this provider', exact: true }).count()).toBe(0)
    await page.locator('.pod-button').first().click()
    await page.getByRole('tab', { name: 'Settings', exact: true }).click()
    const identityCard = page.getByRole('article', { name: 'Pod identity', exact: true })
    await identityCard.getByText(identity.subject, { exact: true }).waitFor()
    expect(await identityCard.textContent()).toContain('original@example.invalid')
    expect(await identityCard.textContent()).not.toContain('new-default@example.invalid')
    expect(await identityCard.getByText('Identity details', { exact: true }).evaluate(element => element.parentElement?.hasAttribute('open'))).toBe(false)
    await identityCard.scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve('.artifacts/pod-identity.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840))
    await page.emulateMedia({ colorScheme: 'dark' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await identityCard.scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve('.artifacts/pod-identity-narrow-dark.png') })
    await identityCard.getByRole('button', { name: 'Manage your accounts', exact: true }).click()
    await page.getByRole('heading', { name: 'Your accounts', exact: true }).waitFor()

    await app.close(); app = await launch(); page = await app.firstWindow()
    await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    expect((await page.evaluate(() => window.pods.onboarding({ type: 'list' }))).defaultOwner).toBe(second)
    await expect.poll(() => page.getByRole('button', { name: 'OpenApe account', exact: true }).textContent()).toContain('new-default@example.invalid')
    await page.locator('.pod-button').first().waitFor()
    await page.getByRole('button', { name: 'OpenApe account', exact: true }).click()
    await page.getByRole('heading', { name: 'Your accounts', exact: true }).waitFor()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/central-account-narrow-dark.png') })
    await page.getByRole('button', { name: 'App settings', exact: true }).click(); await page.getByLabel('Language', { exact: true }).selectOption('de')
    await page.getByRole('button', { name: 'OpenApe-Konto', exact: true }).click()
    await page.getByRole('heading', { name: 'Deine Konten', exact: true }).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/central-account-narrow-dark-de.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1180, 850)); await page.emulateMedia({ colorScheme: 'light' })
    await page.screenshot({ path: resolve('.artifacts/central-account-de.png') })
    await page.locator('.pod-button').first().click()
    await page.getByRole('tab', { name: 'Einstellungen', exact: true }).click()
    await page.getByRole('article', { name: 'Pod-Identität', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve('.artifacts/pod-identity-de.png') })
    await page.getByRole('button', { name: 'Sidebar einklappen', exact: true }).click()
    expect(await page.locator('.account-avatar').isVisible()).toBe(true)
    await app.close()
    const reopened = new PodDatabase(root)
    try {
      const control = new SetupControl(reopened, new ResourceRegistry(reopened, () => {}))
      expect(control.connections.metadata(first)).toEqual(metadata)
      expect(reopened.getPod(pod.id)).toEqual(pod)
      expect(reopened.db.prepare('SELECT * FROM schedules').all()).toEqual([])
    }
    finally { reopened.close() }
  }
  finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

it('broker provider settings: explicit consent, retained provider and readable narrow layout (packaged)', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-broker-ui-'))); fixtureDirectory(root)
  const store = new PodDatabase(root)
  const freshPod = store.createPod({ name: 'New provider pod' }); const connectedPod = store.createPod({ name: 'Connected provider pod' })
  const broker = { issuer: 'https://pods.example.invalid', domain: 'pods.example.invalid', connectionId: randomUUID() }
  const setup = new SetupControl(store, new ResourceRegistry(store, () => {}))
  const owner = randomUUID(); const connected = randomUUID()
  for (const [id, account, metadata] of [
    [owner, 'new-owner@example.invalid', { issuer: 'https://id.example.invalid', pods: { [freshPod.id]: { connectionId: randomUUID(), prepared: false } } }],
    [connected, 'connected-owner@example.invalid', { issuer: 'https://id.example.invalid', broker, pods: { [connectedPod.id]: { connectionId: randomUUID(), prepared: false, broker } } }],
  ] as const) setup.execute({ type: 'save', connection: { id, provider: 'openape', account, state: 'ready', error: null }, metadata })
  store.close()
  const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  try {
    const page = await app.firstWindow()
    await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await page.locator('.pod-button').filter({ hasText: freshPod.name }).click()
    await page.getByRole('tab', { name: 'Settings', exact: true }).click()
    const fresh = page.getByRole('article', { name: 'Pod identity', exact: true })
    await fresh.getByText('Agent provider permission', { exact: true }).click()
    await fresh.getByRole('button', { name: 'Allow requests from this provider', exact: true }).click()
    await fresh.getByText('Decisions remain with new-owner@example.invalid.', { exact: true }).waitFor()
    expect(await fresh.getByRole('button', { name: 'Confirm permission', exact: true }).isVisible()).toBe(true)
    expect((await page.evaluate(() => window.pods.onboarding({ type: 'list' }))).connections[0]?.broker).toBeUndefined()
    await mkdir(resolve('.artifacts'), { recursive: true })
    await page.screenshot({ path: resolve('.artifacts/broker-provider-consent.png'), fullPage: true })
    await fresh.getByRole('button', { name: 'Cancel', exact: true }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 840)); await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('.pod-button').filter({ hasText: connectedPod.name }).click()
    await page.getByRole('tab', { name: 'Settings', exact: true }).click()
    const provider = page.getByRole('article', { name: 'Pod identity', exact: true })
    await provider.getByText('Agent provider permission', { exact: true }).click()
    await provider.getByRole('button', { name: 'Revoke provider permission', exact: true }).click()
    await provider.getByRole('button', { name: 'Confirm revocation', exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/broker-provider-connected-dark.png') })
    expect((await page.evaluate(() => window.pods.onboarding({ type: 'list' }))).connections[1]?.broker?.domain).toBe('pods.example.invalid')
    expect((await page.evaluate(() => window.pods.workspace({ type: 'list' })))).toMatchObject({ pods: [freshPod, connectedPod] })
    await page.getByRole('button', { name: 'App settings', exact: true }).click(); await page.getByLabel('Language', { exact: true }).selectOption('de')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1180, 1000)); await page.emulateMedia({ colorScheme: 'light' })
    await page.locator('.pod-button').filter({ hasText: freshPod.name }).click()
    await page.getByRole('tab', { name: 'Einstellungen', exact: true }).click()
    const permission = page.getByRole('article', { name: 'Pod-Identität', exact: true })
    await permission.getByText('Erlaubnis für den Agenten-Anbieter', { exact: true }).click()
    await permission.getByRole('button', { name: 'Anfragen von diesem Anbieter erlauben', exact: true }).click()
    expect(await permission.getByText('Du erteilst diese Erlaubnis mit deinem DDISA-Konto. Eine zusätzliche Anmeldung beim Agenten-Anbieter ist nicht nötig.', { exact: true }).isVisible()).toBe(true)
    await permission.getByRole('button', { name: 'Erlaubnis bestätigen', exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/broker-provider-consent-de.png') })
  }
  finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
