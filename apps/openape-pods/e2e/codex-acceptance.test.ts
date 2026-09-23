import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { _electron as electron } from 'playwright'
import type { ElectronApplication } from 'playwright'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { fixtureDirectory } from '../src/main/fixture'
import { fixtureShellIdentity } from './fixtures/shell-identity'

// Issue 1375 acceptance: the bundled Codex CLI, with an isolated CODEX_HOME,
// reaches the packaged app through the registration the owner made in App
// settings. Codex prepares; only the owner's own surface applies or runs.
const bundle = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents')
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const secrets = ['SYNTHETIC_OWNER_TOKEN', 'SYNTHETIC_REFRESH_TOKEN', 'SYNTHETIC_NOT_A_REAL_KEY', 'LOCAL_SYNTHETIC_TOKEN']
const ownerConfig = '# Owner Codex settings\nmodel = "gpt-5.1"\n'

function appServer(home: string) {
  const child = spawn(join(bundle, 'Resources/app.asar.unpacked/dist/vendor/codex'), ['app-server', '--stdio'], { env: { CODEX_HOME: home, HOME: home, PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] })
  let next = 0; const waiting = new Map<number, (message: Record<string, any>) => void>(); const statuses: Record<string, string> = {}
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line) as { id?: number, method?: string, params?: { name: string, status: string } }
    if (message.method === 'mcpServer/startupStatus/updated') statuses[message.params!.name] = message.params!.status
    if (message.id !== undefined) { waiting.get(message.id)?.(message); waiting.delete(message.id) }
  })
  const request = (method: string, params: unknown) => new Promise<Record<string, any>>((done) => { const id = ++next; waiting.set(id, done); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`) })
  return { request, statuses, notify: (method: string) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`), close: () => child.kill() }
}

it('lets the owner\'s Codex prepare changes that land only through the app\'s review (packaged)', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-codex-'))); fixtureDirectory(root)
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const store = new PodDatabase(root); store.createPod({ name: 'Invoices' }); store.close()
  const home = join(root, 'owner-codex'); await mkdir(home, { mode: 0o700 }); await writeFile(join(home, 'config.toml'), ownerConfig)
  const identity = await fixtureShellIdentity(root, ['fixture.read']); cleanups.push(() => identity.close())
  const app: ElectronApplication = await electron.launch({ executablePath: join(bundle, 'MacOS/OpenApe Pods Fixture'), cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, OPENAPE_PODS_FIXTURE_CODEX_HOME: home, NODE_ENV: 'test' }, timeout: 20000 })
  cleanups.push(() => app.close())
  await identity.encrypt(app, true)
  const page = await app.firstWindow()
  await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state, { timeout: 20000 }).toBe('ready')
  await page.evaluate(() => window.pods.onboarding({ type: 'finish' }))

  // Owner connects in App settings; only one marked block is appended.
  expect(await page.evaluate(() => window.pods.codex({ type: 'connect' }))).toMatchObject({ state: 'connected', home })
  expect((await readFile(join(home, 'config.toml'), 'utf8')).startsWith(ownerConfig)).toBe(true)

  const codex = appServer(home); cleanups.push(async () => { codex.close() })
  await codex.request('initialize', { clientInfo: { name: 'acceptance', version: '0' } }); codex.notify('initialized')
  const threadId = (await codex.request('thread/start', {})).result.thread.id as string
  await expect.poll(() => codex.statuses['openape-pods'], { timeout: 20000 }).toBe('ready')
  const outputs: string[] = []
  const call = async (action: Record<string, unknown>) => {
    const reply = await codex.request('mcpServer/tool/call', { threadId, server: 'openape-pods', tool: 'pods_control', arguments: action })
    const text = reply.result.content[0].text as string; outputs.push(text)
    return { error: reply.result.isError === true, value: reply.result.isError ? text : JSON.parse(text) }
  }

  const [pod] = (await call({ action: 'list' })).value.pods as { id: string, name: string, revision: number }[]
  expect(pod!.name).toBe('Invoices')
  await call({ action: 'select', podIds: [pod!.id] })
  expect((await call({ action: 'revise', podId: pod!.id, revision: pod!.revision, name: 'Invoices 2026' })).value).toMatchObject({ name: 'Invoices 2026' })
  const revision = (await call({ action: 'inspect', podId: pod!.id, revision: pod!.revision + 1 })).value.pod.revision as number
  expect((await call({ action: 'setVariable', podId: pod!.id, revision, name: 'recipient', value: 'ops@example.invalid', variableRevision: 0 })).value.status).toBe('pending-owner-review')
  expect((await call({ action: 'run', podId: pod!.id, revision })).value.status).toBe('pending-owner-review')
  expect((await call({ action: 'applyChanges', id: pod!.id, revision: 1 })).error).toBe(true)
  const variables = async () => (await call({ action: 'inspect', podId: pod!.id, revision })).value.variables as { name: string, value: string }[]
  expect(await variables()).toEqual([])

  // The owner sees both requests under Prepared by Codex and applies only the change.
  await page.reload()
  await page.getByRole('button', { name: /Prepared by Codex/ }).click()
  await expect.poll(() => page.getByText('ops@example.invalid').count()).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Apply changes together' }).click()
  await expect.poll(async () => (await variables()).map(variable => [variable.name, variable.value])).toEqual([['recipient', 'ops@example.invalid']])
  const { changes } = (await call({ action: 'changes' })).value as { changes: { kind: string, state: string }[] }
  expect(changes.map(set => [set.kind, set.state]).sort()).toEqual([['changes', 'applied'], ['run', 'pending']])
  expect((await call({ action: 'inspect', podId: pod!.id, revision })).value.runs).toEqual([])

  for (const secret of secrets) expect(outputs.join('\n')).not.toContain(secret)
  expect(await page.evaluate(() => window.pods.codex({ type: 'disconnect' }))).toMatchObject({ state: 'disconnected' })
  expect(await readFile(join(home, 'config.toml'), 'utf8')).toBe(ownerConfig)
})
