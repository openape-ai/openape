import { randomUUID } from 'node:crypto'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { RunDispatcher } from '../src/worker/runs/dispatcher'
import type { AgentRuntime } from '../src/worker/agent/executor'
import { installExample } from '../src/worker/runs/examples'
import { DefinitionCatalog } from '../src/worker/workspace/definition-catalog'
import { PodGroups } from '../src/worker/workspace/groups'
import { NetworkEngine } from '../src/worker/scheduling/network-engine'
import type { Owner } from '@openape/pods-protocol'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { _electron as electron } from 'playwright'
import type { ElectronApplication } from 'playwright'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase, digest } from '../src/worker/storage/database'
import { fixtureDirectory } from '../src/main/fixture'
import { fixtureShellIdentity } from './fixtures/shell-identity'

// Issue 1375 acceptance: the bundled Codex CLI, with an isolated CODEX_HOME,
// reaches the packaged app through the registration the owner made in App
// settings. Connected Codex administers directly, without a second app review.
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

async function seedPausedNetwork(root: string, owner: Owner) {
  const store = new PodDatabase(root)
  const resources = new ResourceRegistry(store, () => {})
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  const helper = resolve('dist/native/pods-helper')
  const dispatcher = new RunDispatcher(store, resources, { helper, environment: {} } as AgentRuntime)
  const engine = new NetworkEngine(store, dispatcher, resources, helper, () => owner)
  try {
    const groups = new PodGroups(store)
    groups.execute({ type: 'organize', action: 'create', name: 'MCP company', revision: groups.view().revision })
    const groupId = groups.view().groups.at(-1)!.id
    const catalog = new DefinitionCatalog(store, resources, owner)
    const members: string[] = []
    for (const name of ['MCP source', 'MCP consumer']) {
      const pod = store.createPod({ name }); members.push(pod.id)
      groups.execute({ type: 'organize', action: 'move', podId: pod.id, groupId, revision: groups.view().revision })
      installExample(store, resources, pod.id, 'deterministic', runtime.dependencyLockHash)
      const original = JSON.parse(store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(pod.id)!.manifest as string)
      const source = members.length === 1
      const contract = { takes: source ? [] : ['input'], gives: source ? ['input'] : [], summary: name }
      const code = `export const contract=${JSON.stringify(contract)}; export async function run(context) { ${source ? 'await context.network.emit({channel:\'input\',key:\'once\',sourceItemId:\'once\',sourceVersion:\'1\',payload:{subject:\'Synthetic MCP input\'}});' : ''} return {status:'completed',summary:'Synthetic MCP network',completedInputIds:context.input.eventIds,gapIds:[]}; }`
      const hash = digest(code)
      store.storeScript(pod.id, { ...original, contentHash: hash, contract }, code)
      store.db.prepare('UPDATE pods SET active_script=? WHERE id=?').run(hash, pod.id)
      store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(pod.id, hash, pod.bindingRevision, 0, '{"synthetic":true,"nativeMcp":true}')
      await catalog.publish(pod.id, hash, name, {}, apply => apply())
    }
    store.db.prepare('INSERT INTO remote_registration VALUES(1,?,0)').run(JSON.stringify({ owner }))
    const id = engine.execute({ type: 'create', draft: { name: 'MCP paused network', groupId, members: members.map((podId, index) => ({ podId, source: index ? null : { schedule: null }, serialCase: false })), channels: [{ name: 'input', title: 'Input', schemaVersion: 1, schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false } }] } }).createdId!
    return { id, source: members[0]!, members }
  }
  finally { await engine.stop(); await dispatcher.stop(); store.close() }
}

it.each([false, true])('lets connected Codex configure and run an unrelated Pod beside a paused network (packaged, network=%s)', async (withNetwork) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-codex-'))); fixtureDirectory(root)
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const store = new PodDatabase(root); store.createPod({ name: 'Invoices' }); store.close()
  const home = join(root, 'owner-codex'); await mkdir(home, { mode: 0o700 }); await writeFile(join(home, 'config.toml'), ownerConfig)
  const identity = await fixtureShellIdentity(root, ['fixture.read']); cleanups.push(() => identity.close())
  const network = withNetwork ? await seedPausedNetwork(root, identity.owner) : null
  if (network) identity.attachPods()
  const app: ElectronApplication = await electron.launch({ executablePath: join(bundle, 'MacOS/OpenApe Pods Fixture'), cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, OPENAPE_PODS_FIXTURE_CODEX_HOME: home, OPENAPE_PODS_FIXTURE_MCP_OWNER: 'synthetic', NODE_ENV: 'test' }, timeout: 20000 })
  cleanups.push(() => app.close())
  await identity.encrypt(app, true)
  const page = await app.firstWindow()
  await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state, { timeout: 20000 }).toBe('ready')
  await page.evaluate(() => window.pods.onboarding({ type: 'finish' }))

  // The owner connects Codex in App settings; only one marked block is appended.
  // Fixture runs replace only the browser sign-in; the owner still confirms natively.
  await app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox.bind(dialog)
    dialog.showMessageBox = (async (...args: Parameters<typeof dialog.showMessageBox>) => {
      const options = args.at(-1) as { message?: string }
      return options.message === 'Codex requests full Pods access for one hour' ? { response: 1, checkboxChecked: false } : original(...args)
    }) as typeof dialog.showMessageBox
  })
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

  const refused = await call({ action: 'list' })
  expect(refused.error).toBe(true); expect(JSON.parse(refused.value as string)).toMatchObject({ error: 'login_required' })
  await expect.poll(async () => (await call({ action: 'runtime' })).error, { timeout: 20000 }).toBe(false)
  expect(await page.evaluate(() => window.pods.mcpSession({ type: 'get' }))).toMatchObject({ expiresAt: expect.any(Number) })
  const listed = await call({ action: 'list' })
  expect(listed, JSON.stringify(listed)).toMatchObject({ error: false })
  const pod = (listed.value.pods as { id: string, name: string, revision: number }[]).find(pod => pod.name === 'Invoices')
  expect(pod!.name).toBe('Invoices')
  await call({ action: 'select', podIds: [pod!.id] })
  expect((await call({ action: 'revise', podId: pod!.id, revision: pod!.revision, name: 'Invoices 2026' })).value).toMatchObject({ name: 'Invoices 2026' })
  const revision = (await call({ action: 'inspect', podId: pod!.id, revision: pod!.revision + 1 })).value.pod.revision as number
  expect((await call({ action: 'setVariable', podId: pod!.id, revision, name: 'recipient', value: 'ops@example.invalid', variableRevision: 0 })).value.variables).toEqual([{ name: 'recipient', value: 'ops@example.invalid', revision: 1 }])
  const secretPath = join(root, 'private-token'); await writeFile(secretPath, 'LOCAL_SYNTHETIC_TOKEN', { mode: 0o600 })
  const imported = await call({ action: 'importSecret', revision, command: { podId: pod!.id, alias: 'test_token', epoch: 0 }, path: secretPath })
  expect(imported.error).toBe(false)
  expect(imported.value.resources).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'credential' })]))
  const current = (await call({ action: 'list' })).value.pods.find((candidate: { id: string }) => candidate.id === pod!.id)
  const code = `export async function run(context) {
    await context.progress.commit({expectedRevision:context.input.checkpointRevision,checkpoint:{ran:true},sources:[],claims:[]});
    return {status:'completed',summary:'Synthetic Codex run',completedInputIds:context.input.eventIds,gapIds:[]};
  }`
  const draft = (await call({ action: 'draft', podId: pod!.id, revision: current.revision, draftId: null, draftRevision: 0, code, capabilities: [] })).value
  const scoped = { podId: pod!.id, revision: current.revision }
  expect((await call({ action: 'validate', ...scoped, draftId: draft.draftId, draftRevision: draft.draftRevision })).error).toBe(false)
  expect((await call({ action: 'activate', ...scoped, draftId: draft.draftId, draftRevision: draft.draftRevision })).error).toBe(false)
  expect((await call({ action: 'resume', ...scoped })).value.lifecycle).toBe('active')
  expect((await call({ action: 'setSchedule', ...scoped, scheduleRevision: 0, spec: { kind: 'interval', seconds: 900 }, enabled: true })).value.schedule.enabled).toBe(true)
  const started = await call({ action: 'run', ...scoped })
  expect(started.error).toBe(false); expect(started.value.runId).toMatch(/^[a-f0-9-]{36}$/)
  await expect.poll(async () => (await call({ action: 'inspect', ...scoped })).value.runs.find((run: { id: string }) => run.id === started.value.runId)?.state, { timeout: 20000 }).toBe('completed')
  expect((await call({ action: 'changes' })).value.changes).toEqual([])
  if (network) {
    expect((await call({ action: 'runtime' })).value.networks).toHaveProperty('reads')
    expect((await call({ action: 'networks', command: { type: 'list' } })).value.networks).toMatchObject([{ id: network.id, state: 'paused' }])
    const detail = await call({ action: 'networks', command: { type: 'detail', id: network.id, revision: 1 } })
    expect(detail.error).toBe(false); expect(detail.value.details.members).toHaveLength(2)
    await call({ action: 'select', podIds: [pod!.id, network.source] })
    expect((await call({ action: 'run', podId: network.source, revision: 1 })).value).toContain('Network instances require network intake and dispatch')
    expect((await call({ action: 'networks', command: { type: 'list' } })).error).toBe(false)
    const previewRequest = { action: 'networks', requestId: randomUUID(), command: { type: 'preview', id: network.id, revision: 1, podIds: [network.source], pausedPodIds: [network.source], budget: 1 } }
    const preview = await call(previewRequest)
    expect(preview.error).toBe(false); expect(await call(previewRequest)).toEqual(preview)
    const processing = { action: 'networks', requestId: randomUUID(), command: { type: 'process', id: network.id, revision: 1, previewId: preview.value.preview.id } }
    const processed = await call(processing)
    expect(processed.error).toBe(false); expect(await call(processing)).toEqual(processed)
    await expect.poll(async () => {
      const result = await call({ action: 'networks', command: { type: 'trace', id: network.id, revision: 1, before: null, caseId: null } })
      return result.value.trace.events.some((event: { kind: string }) => event.kind === 'invocation-settled')
    }).toBe(true)
    const verified = new PodDatabase(root)
    try {
      expect(verified.db.prepare('SELECT state FROM networks WHERE id=?').get(network.id)!.state).toBe('paused')
      expect(verified.db.prepare('SELECT count(*) AS n FROM network_invocations').get()!.n).toBe(1)
      expect(verified.db.prepare('SELECT count(*) AS n FROM network_events').get()!.n).toBe(1)
      expect(verified.db.prepare('SELECT lifecycle FROM pods WHERE id=?').get(network.source)!.lifecycle).toBe('paused')
    }
    finally { verified.close() }
  }
  await page.reload()
  expect(await page.getByRole('tab', { name: 'Chat', exact: true }).count()).toBe(0)
  expect(await page.getByRole('button', { name: /Prepared by Codex/ }).count()).toBe(0)

  if (network) {
    await page.getByRole('button', { name: 'Networks & workflows', exact: true }).first().click()
    await page.getByRole('button', { name: /MCP paused network/ }).click()
    await page.getByRole('heading', { name: 'MCP paused network', exact: true }).waitFor()
    await mkdir(resolve('.artifacts'), { recursive: true })
    await page.screenshot({ path: resolve('.artifacts/network-mcp-native-paused.png'), fullPage: true })
  }
  for (const secret of secrets) expect(outputs.join('\n')).not.toContain(secret)
  expect(await page.evaluate(() => window.pods.codex({ type: 'disconnect' }))).toMatchObject({ state: 'disconnected' })
  expect(await readFile(join(home, 'config.toml'), 'utf8')).toBe(ownerConfig)
})
