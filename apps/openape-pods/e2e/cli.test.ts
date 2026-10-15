import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, realpath, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startCliClient } from '../src/cli/client'
import type { CliClient } from '../src/cli/client'
import { nodeHost } from '../src/cli/node-host'
import { executeCli } from '../src/cli/commands'
import { cliArguments } from '../src/cli/arguments'
import { safeStorageCipher } from '../src/cli/safe-storage'
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
const cipher = () => safeStorageCipher(() => Buffer.from('SYNTHETIC_CLI_KEYCHAIN'))
const outputs: unknown[] = []
const events: unknown[] = []
const io = () => ({ signal: new AbortController().signal, output: (value: unknown) => outputs.push(value), progress: (value: unknown) => events.push(value) })
async function open(profile: string) {
  const host = nodeHost(resolve('dist'))
  return startCliClient(profile, profile, { ...host, credentials: path => new CredentialCache(path, cipher()) })
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
  identity = await fixtureShellIdentity(profile)
  await identity.persistCredentials(value => cipher().encrypt(value))
  const script = join(root, 'pod-script.mjs')
  await writeFile(script, `import { readFile } from 'node:fs/promises';
export const contractVersion = 2;
export async function run(context) {
  if (context.input.validation) return {status:'completed',summary:'Synthetic contract check',completedInputIds:[],gapIds:[]};
  let denied = false; try { await context.data.get('cli/private/foreign'); } catch { denied = true; }
  if (!denied) throw new Error('Foreign namespace was readable');
  let protectedDenied = false; try { await readFile(${JSON.stringify(protectedFile)}, 'utf8'); } catch { protectedDenied = true; }
  if (!protectedDenied) throw new Error('Owner authentication store was readable');
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
  expect(await readFile(protectedFile, 'utf8')).toBe('SYNTHETIC_OWNER_LOGIN_DO_NOT_READ')
  if (level === 'owner') {
    await writeFile(script, `export async function run(context) {
      if (!context.input.validation) await new Promise(resolve => setTimeout(resolve, 30000));
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
        progress: (value) => { events.push(value); if ((value as { type?: string }).type === 'process') controller.abort() },
      })
      expect(exit).toBe(130)
      expect(outputs.at(-1)).toMatchObject({ podId: id, state: 'cancelled' })
    }
    finally { clearTimeout(deadline) }
  }
})

it('refuses a run without a Pod identity before any script process starts', async () => {
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
  expect(await executeCli(cliArguments(['run', pod.id]), client, io())).toBe(1)
  expect(outputs.at(-1)).toMatchObject({ state: 'failed', checkpointRevision: 0, error: expect.stringMatching(/DDISA|identity/) })
  await client.close(); client = undefined
  const reopened = new PodDatabase(root)
  try {
    expect(reopened.checkpoint(pod.id).revision).toBe(0)
    expect(reopened.db.prepare('SELECT count(*) AS n FROM run_events WHERE type=\'process\'').get()!.n).toBe(0)
  }
  finally { reopened.close() }
})
