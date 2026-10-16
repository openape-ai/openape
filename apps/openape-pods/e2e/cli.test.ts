import { createHash, randomUUID } from 'node:crypto'
import { ProgramState } from '../src/main/programs/state'
import { parseScriptView } from '../src/contracts/scripts'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { mkdtemp, realpath, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startCliClient } from '../src/cli/client'
import type { CliClient } from '../src/cli/client'
import { nodeHost } from '../src/cli/node-host'
import { executeCli } from '../src/cli/commands'
import { cliArguments } from '../src/cli/arguments'
import { CredentialCache } from '../src/main/connections/cache'
import { PodDatabase } from '../src/worker/storage/database'
import { DomainData } from '../src/worker/data/domain'
import { GrantLedger } from '../src/worker/resources/grants'
import { ItemTagStore } from '../src/worker/workspace/item-tags'
import { installExample } from '../src/worker/runs/examples'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { fixtureShellIdentity } from './fixtures/shell-identity'

const exec = promisify(execFile)
let root = ''; let client: CliClient | undefined
let identity: Awaited<ReturnType<typeof fixtureShellIdentity>> | undefined
afterEach(async () => { await client?.close(); client = undefined; await identity?.close(); identity = undefined; vi.unstubAllEnvs(); if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })
const cipher = () => ({ available: () => true, encrypt: (value: string) => Buffer.from(value).reverse(), decrypt: (value: Buffer) => Buffer.from(value).reverse().toString() })
const outputs: unknown[] = []
const events: unknown[] = []
const io = () => ({ signal: new AbortController().signal, output: (value: unknown) => outputs.push(value), progress: (value: unknown) => events.push(value) })
async function open(profile: string) {
  const host = nodeHost(resolve('dist'))
  return startCliClient(profile, profile, host)
}

it('runs the built create/list/edit commands as Node processes and reopens the real database', async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-cli-process-')))
  const binary = resolve('dist/cli/entry.cjs')
  const command = async (args: string[]) => {
    const result = await exec(process.execPath, [binary, ...args, '--profile', root, '--json'], { timeout: 15000 })
    return JSON.parse(result.stdout)
  }
  const created = await command(['create', '--name', 'Small independent task', '--tags', 'dev,cli'])
  await command(['edit', created.id, '--name', 'Edited from CLI', '--tags', 'tested'])
  const list = await command(['list'])
  expect(list.pods).toEqual([expect.objectContaining({ id: created.id, name: 'Edited from CLI', tags: ['tested'], lifecycle: 'paused' })])
  const store = new PodDatabase(root)
  try { expect(store.getPod(created.id).name).toBe('Edited from CLI'); expect(new ItemTagStore(store).own(created.id)).toEqual(['tested']) }
  finally { store.close() }
  await expect(command(['run', created.id])).rejects.toMatchObject({ code: 2 })
})

it.each(['owner', 'isolated'] as const)('executes with the real Pod identity, %s home and Pod-scoped shared storage', async (level) => {
  outputs.length = 0; events.length = 0
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-cli-native-')))
  const profile = join(root, 'profile'); const ownerHome = join(root, 'owner')
  await mkdir(profile, { mode: 0o700 }); await mkdir(join(ownerHome, '.config/apes'), { recursive: true, mode: 0o700 })
  const protectedFile = join(ownerHome, '.config/apes/auth.json')
  await writeFile(protectedFile, 'SYNTHETIC_OWNER_LOGIN_DO_NOT_READ')
  vi.stubEnv('HOME', ownerHome)
  expect(homedir()).toBe(ownerHome)
  client = await open(profile)
  await executeCli(cliArguments(['create', '--name', 'Context proof']), client, io())
  const id = (outputs.at(-1) as { id: string }).id
  await client.close(); client = undefined
  let store = new PodDatabase(profile)
  try {
    const other = store.createPod({ name: 'Not running' })
    const data = new DomainData(store)
    data.define({ path: 'cli/state', writer: id, mode: 'records' })
    data.define({ path: 'cli/private', writer: other.id, mode: 'records' })
    new GrantLedger(store).execute({ type: 'level', podId: id, level })
  }
  finally { store.close() }
  identity = await fixtureShellIdentity(profile, [], false, false, true)
  await writeFile(protectedFile, identity.ownerLogin, { mode: 0o600 })
  await identity.persistCredentials(value => cipher().encrypt(value))
  const credentialRoot = join(profile, 'credentials')
  const desktop = new CredentialCache(credentialRoot, cipher())
  const files = await readdir(credentialRoot)
  for (const file of files.filter(file => file.endsWith('.encrypted'))) await desktop.readConnection(file.slice(0, -'.encrypted'.length))
  const protectedIdentity = join(credentialRoot, (await readdir(credentialRoot)).find(file => file.endsWith('.identity.json'))!)
  const script = join(root, 'pod-script.mjs')
  await writeFile(script, `import { readFile, writeFile } from 'node:fs/promises';
export const contractVersion = 2;
export async function run(context) {
  if (context.input.validation) return {status:'completed',summary:'Synthetic contract check',completedInputIds:[],gapIds:[]};
  let denied = false; try { await context.data.get('cli/private/foreign'); } catch { denied = true; }
  if (!denied) throw new Error('Foreign namespace was readable');
  let protectedDenied = false; try { await readFile(${JSON.stringify(protectedFile)}, 'utf8'); } catch { protectedDenied = true; }
  if (!protectedDenied) throw new Error('Owner authentication store was readable');
  for (const path of [${JSON.stringify(protectedIdentity)},${JSON.stringify(protectedIdentity)} + '.new']) {
    let readDenied = false; try { await readFile(path, 'utf8'); } catch { readDenied = true; }
    let writeDenied = false; try { await writeFile(path, 'DO_NOT_WRITE'); } catch { writeDenied = true; }
    if (!readDenied || !writeDenied) throw new Error('Pod identity store was accessible');
  }
  const value = {home:process.env.HOME,cwd:process.cwd(),podId:context.input.podId,denied,protectedDenied};
  await context.data.set('cli/state/context',value,{expectedRevision:0});
  await context.progress.commit({expectedRevision:context.input.checkpointRevision,checkpoint:{checked:true},sources:[],claims:[]});
  context.log(JSON.stringify(value));
  return {status:'completed',summary:'Identity, context and shared-data checks passed',completedInputIds:[],gapIds:[]};
}`)
  client = await open(profile)
  await executeCli(cliArguments(['edit', id, '--tags', 'native,verified', '--script', script]), client, io())
  await expect(open(profile)).rejects.toThrow(/locked|busy/)
  const exitCode = await executeCli(cliArguments(['run', id]), client, io())
  expect(exitCode, JSON.stringify(outputs.at(-1))).toBe(0)
  expect(outputs.at(-1)).toMatchObject({ podId: id, state: 'completed', checkpointRevision: 1 })
  await client.close(); client = undefined
  store = new PodDatabase(profile)
  try {
    const value = new DomainData(store).get({ podId: id, runId: 'inspection' }, 'cli/state/context')!.value
    expect(value).toEqual({ home: level === 'owner' ? ownerHome : join(profile, 'pods', id, 'home'), cwd: join(profile, 'pods', id, 'workspace'), podId: id, denied: true, protectedDenied: true })
    expect(store.checkpoint(id).body).toEqual({ checked: true })
    expect(store.db.prepare('SELECT DISTINCT pod_id FROM runs').all()).toEqual([{ pod_id: id }])
    expect(new ItemTagStore(store).own(id)).toEqual(['native', 'verified'])
    const records = store.db.prepare('SELECT state,error FROM runs WHERE pod_id=?').all(id)
    expect(records).toEqual([{ state: 'completed', error: null }])
  }
  finally { store.close() }
  expect(await readFile(protectedFile, 'utf8')).toBe(identity.ownerLogin)
  expect(identity.ownerDecisions()).toHaveLength(1)
  const startCalls = identity.authorizations().filter(item => item.call.grant_type === 'once')
  expect(startCalls).toHaveLength(2)
  expect(startCalls[0]!.grantId).toBe(startCalls[1]!.grantId)
  for (const field of ['program', 'argv', 'files', 'grant_type', 'target_host']) expect(startCalls[0]!.call[field]).toEqual(startCalls[1]!.call[field])
  if (level === 'owner') {
    await writeFile(script, `export async function run(context) {
      if (!context.input.validation) { context.log('Started waiting'); await new Promise(resolve => setTimeout(resolve, 30000)); }
      return {status:'completed',summary:'Finished waiting',completedInputIds:[],gapIds:[]};
    }`)
    client = await open(profile)
    await executeCli(cliArguments(['edit', id, '--script', script]), client, io())
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), 5000)
    try {
      const exit = await executeCli(cliArguments(['run', id]), client, {
        signal: controller.signal,
        output: value => outputs.push(value),
        progress: (value) => { events.push(value); if ((value as { type?: string }).type === 'log') controller.abort() },
      })
      expect(exit).toBe(130)
      expect(outputs.at(-1)).toMatchObject({ podId: id, state: 'cancelled' })
      await client.close(); client = undefined
      const cancelled = new PodDatabase(profile)
      try {
        expect(cancelled.db.prepare('SELECT count(*) AS n FROM effect_ledger WHERE state=\'intent\'').get()!.n).toBe(0)
        expect(cancelled.db.prepare('SELECT count(*) AS n FROM effect_ledger WHERE state=\'unknown\'').get()!.n).toBe(1)
      }
      finally { cancelled.close() }
    }
    finally { clearTimeout(deadline) }
  }
})

it('executes an assigned owner program without opening its encrypted application state', async () => {
  outputs.length = 0; events.length = 0
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-cli-owner-program-')))
  const ownerHome = join(root, 'owner'); await mkdir(join(ownerHome, '.config/apes'), { recursive: true, mode: 0o700 })
  vi.stubEnv('HOME', ownerHome)
  const profile = join(root, 'profile'); await mkdir(profile, { mode: 0o700 })
  const store = new PodDatabase(profile)
  const applicationId = randomUUID(); const capability = `tool.app_${applicationId.replaceAll('-', '')}.invoke`
  const desktop = new CredentialCache(join(profile, 'credentials'), cipher())
  let podId = ''; let stateId = ''
  try {
    podId = store.createPod({ name: 'Owner program proof' }).id
    new GrantLedger(store).execute({ type: 'level', podId, level: 'owner' })
    stateId = await new ProgramState(desktop).create({ podId, applicationId })
    const executable = '/usr/bin/printenv'
    const registry = new ResourceRegistry(store, () => {})
    registry.assignProgram(podId, applicationId, { type: 'program', name: 'printenv', cliId: 'printenv', executable, executableHash: createHash('sha256').update(await readFile(executable)).digest('hex'), stateId, capability, networkHosts: [], entryFiles: [], environment: {} }, registry.epoch(podId))
  }
  finally { store.close() }
  const encryptedPath = join(profile, 'credentials', `${stateId}.encrypted`)
  const encryptedBefore = await readFile(encryptedPath)
  identity = await fixtureShellIdentity(profile, [], false, false, true)
  await writeFile(join(ownerHome, '.config/apes/auth.json'), identity.ownerLogin, { mode: 0o600 })
  await identity.persistCredentials(value => cipher().encrypt(value))
  for (const file of await readdir(join(profile, 'credentials'))) {
    if (file.endsWith('.encrypted') && file !== `${stateId}.encrypted`) await desktop.readConnection(file.slice(0, -'.encrypted'.length))
  }
  client = await open(profile)
  let view = parseScriptView(await client.request({ channel: 'scripts', command: { type: 'list', podId } }))
  const code = `export async function run(context) {
    if (context.input.validation) return {status:'completed',summary:'Contract check',completedInputIds:[],gapIds:[]};
    const result = await context.tools.invoke({application:'printenv',argv:['HOME']});
    if (result.exitCode !== 0 || result.stdout.trim() !== ${JSON.stringify(homedir())}) throw new Error('Owner program HOME mismatch');
    return {status:'completed',summary:'Assigned owner program executed without a credential cipher',completedInputIds:[],gapIds:[]};
  }`
  view = parseScriptView(await client.request({ channel: 'scripts', command: { type: 'save', podId, revision: view.pod.revision, draftId: null, draftRevision: 0, code, capabilities: [capability] } }))
  view = parseScriptView(await client.request({ channel: 'scripts', command: { type: 'validate', podId, revision: view.pod.revision, draftId: view.source!.id, draftRevision: view.source!.revision } }))
  expect(view.source!.validated, view.source!.evidence ?? '').toBe(true)
  await client.request({ channel: 'scripts', command: { type: 'activate', podId, revision: view.pod.revision, hash: view.source!.hash!, expectedActive: null } })
  expect(await executeCli(cliArguments(['run', podId]), client, io()), JSON.stringify(outputs.at(-1))).toBe(0)
  expect(outputs.at(-1)).toMatchObject({ state: 'completed', summary: 'Assigned owner program executed without a credential cipher' })
  expect(await readFile(encryptedPath)).toEqual(encryptedBefore)
})

it('refuses missing Pod keys despite a valid owner CLI login without falling back to that owner identity', async () => {
  outputs.length = 0; events.length = 0
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-cli-missing-identity-')))
  const profile = join(root, 'profile'); const ownerHome = join(root, 'owner')
  await mkdir(profile); await mkdir(join(ownerHome, '.config/apes'), { recursive: true, mode: 0o700 })
  vi.stubEnv('HOME', ownerHome)
  const store = new PodDatabase(profile)
  const pod = store.createPod({ name: 'Missing Pod key' })
  try {
    const manifest = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
    installExample(store, new ResourceRegistry(store, () => {}), pod.id, 'deterministic', manifest.dependencyLockHash)
  }
  finally { store.close() }
  identity = await fixtureShellIdentity(profile, [], false, false, true)
  await writeFile(join(ownerHome, '.config/apes/auth.json'), identity.ownerLogin, { mode: 0o600 })
  client = await open(profile)
  expect(await executeCli(cliArguments(['run', pod.id]), client, io())).toBe(1)
  expect(outputs.at(-1)).toMatchObject({ state: 'failed', checkpointRevision: 0 })
  expect(events.some(value => (value as { type?: string }).type === 'process')).toBe(false)
  expect(identity.ownerDecisions()).toEqual([])
  expect(identity.authorizations()).toEqual([])
})

it('refuses an unauthenticated CLI start before creating a run or starting a script process', async () => {
  outputs.length = 0; events.length = 0
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-cli-refusal-')))
  const store = new PodDatabase(root)
  const pod = store.createPod({ name: 'No identity' })
  try {
    const manifest = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
    installExample(store, new ResourceRegistry(store, () => {}), pod.id, 'deterministic', manifest.dependencyLockHash)
  }
  finally { store.close() }
  client = await open(root)
  await expect(executeCli(cliArguments(['run', pod.id]), client, io())).rejects.toThrow(/DDISA|owner|identity/)
  await client.close(); client = undefined
  const reopened = new PodDatabase(root)
  try {
    expect(reopened.checkpoint(pod.id).revision).toBe(0)
    expect(reopened.db.prepare('SELECT count(*) AS n FROM runs').get()!.n).toBe(0)
    expect(reopened.db.prepare('SELECT count(*) AS n FROM run_events WHERE type=\'process\'').get()!.n).toBe(0)
  }
  finally { reopened.close() }
})

it('retains the profile lease through a terminal interrupt until the worker closes its pipe', async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-cli-signal-')))
  const helper = spawn(resolve('dist/native/pods-profile-lock'), [join(root, '.runtime.lock')], { stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    const [data] = await once(helper.stdout, 'data')
    expect(data.toString()).toBe('locked\n')
    helper.kill('SIGINT')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(helper.exitCode).toBeNull()
    expect(helper.signalCode).toBeNull()
    await expect(exec(resolve('dist/native/pods-profile-lock'), [join(root, '.runtime.lock')], { timeout: 1000 })).rejects.toMatchObject({ code: 3 })
    const ended = once(helper, 'exit')
    helper.stdin.end()
    expect(await ended).toEqual([0, null])
  }
  finally { helper.kill('SIGKILL') }
})
