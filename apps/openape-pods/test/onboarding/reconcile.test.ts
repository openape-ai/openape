// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PodIdentityManager } from '../../src/main/connections/agent'
import { ConnectionManager } from '../../src/main/connections/manager'
import { CredentialCache } from '../../src/main/connections/cache'
import { PodDatabase, digest } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { SetupControl } from '../../src/worker/onboarding/control'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks() })
const exists = (path: string) => access(path).then(() => true, () => false)

// The profile state observed on September 22: repeated and failed sign-ins for one address,
// a second human identity and two Codex rows.
async function legacyProfile() {
  const root = await mkdtemp(join(tmpdir(), 'pods-reconcile-')); const vendor = join(root, 'vendor'); await mkdir(vendor)
  await writeFile(join(vendor, 'codex'), 'synthetic-codex')
  await writeFile(join(vendor, 'manifest.json'), JSON.stringify({ cli: `0.153.4-${process.platform}-${process.arch}`, binaryHash: digest('synthetic-codex') }))
  const store = new PodDatabase(root); const resources = new ResourceRegistry(store, () => {}); const control = new SetupControl(store, resources)
  // The September 22 profile still holds identities in the retired keychain format, opened here by the migration cipher.
  const credentials = new CredentialCache(join(root, 'credentials'), { available: () => true, decrypt: value => value.toString() })
  const issuer = 'https://id.example.invalid'
  const pods = [store.createPod({ name: 'Delta mail' }), store.createPod({ name: 'Invoices' }), store.createPod({ name: 'Reports' })]
  const rows = { deltaReady: randomUUID(), deltaFailed: randomUUID(), owner: randomUUID(), ownerDuplicate: randomUUID(), codexFailed: randomUUID(), codex: randomUUID() }
  const binding = (index: number, account: string) => { const connectionId = randomUUID(); return { connectionId, prepared: true, identity: { connectionId, podId: pods[index].id, issuer, owner: account, subject: `agent-${index}@example.invalid`, keyId: `key-${index}` } } }
  const bindings = { delta: binding(0, 'phofmann@example.invalid'), owner: binding(1, 'patrick@example.invalid'), duplicate: binding(2, 'patrick@example.invalid') }
  const insert = store.db.prepare('INSERT INTO connections VALUES(?,?,?,?,?,?)')
  insert.run(rows.codexFailed, 'chatgpt', '', 'failed', 'Cancelled', '{}')
  insert.run(rows.deltaReady, 'openape', 'phofmann@example.invalid', 'ready', null, JSON.stringify({ issuer, subject: 'phofmann@example.invalid', pods: { [pods[0].id]: bindings.delta } }))
  insert.run(rows.deltaFailed, 'openape', 'phofmann@example.invalid', 'failed', 'Owner identity does not match the requested account', JSON.stringify({ issuer }))
  insert.run(rows.owner, 'openape', 'patrick@example.invalid', 'ready', null, JSON.stringify({ issuer, subject: 'patrick@example.invalid', pods: { [pods[1].id]: bindings.owner } }))
  insert.run(rows.ownerDuplicate, 'openape', 'patrick@example.invalid', 'revoked', null, JSON.stringify({ issuer, subject: 'patrick@example.invalid', pods: { [pods[2].id]: bindings.duplicate } }))
  insert.run(rows.codex, 'chatgpt', 'model@example.invalid', 'ready', null, JSON.stringify({ accountId: 'synthetic' }))
  store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,?,?,?)').run(randomUUID(), pods[0].id, 'connection', 'ready', 'Historical OpenApe pod agent', JSON.stringify({ provider: 'openape', identity: bindings.delta.identity, ownerConnection: rows.deltaReady }))
  store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,?,?,?)').run(randomUUID(), pods[2].id, 'connection', 'ready', 'Historical OpenApe pod agent', JSON.stringify({ provider: 'openape', identity: bindings.duplicate.identity, ownerConnection: rows.ownerDuplicate }))
  await mkdir(join(root, 'credentials'), { mode: 0o700 })
  for (const item of [bindings.delta, bindings.owner, bindings.duplicate]) await writeFile(join(root, 'credentials', `${item.connectionId}.encrypted`), JSON.stringify({ ...item.identity, privateKey: 'synthetic-key', publicKey: 'synthetic-public-key' }), { mode: 0o600 })
  for (const id of Object.values(rows)) await credentials.create(id, JSON.stringify({ issuer, account: 'synthetic' }))
  await credentials.connect(rows.codex, JSON.stringify({ auth_mode: 'chatgpt', tokens: { account_id: 'synthetic', access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' } }))
  const runtime = { helper: 'unused-fixture-helper', executable: process.execPath, entry: 'unused-entry', runtimeDirectories: [], environment: {}, binary: join(vendor, 'codex'), manifest: join(vendor, 'manifest.json'), catalog: 'unused-catalog', sdkHost: 'unused-host' }
  const start = async () => { const manager = new ConnectionManager(root, runtime, credentials, async command => control.execute(command), async () => {}, async podId => store.getPod(podId).name); await manager.initialize(async () => {}); return manager }
  cleanups.push(async () => { store.close(); await rm(root, { recursive: true, force: true }) })
  return { root, store, resources, control, start, rows, pods, bindings }
}

it('reduces a September 22 profile to one Codex and one DDISA owner without re-provisioning owner Pods', async () => {
  const { root, resources, control, start, rows, pods, bindings } = await legacyProfile()
  const provision = vi.spyOn(PodIdentityManager.prototype, 'provision'); const prepare = vi.spyOn(PodIdentityManager.prototype, 'ensurePrepared')
  const manager = await start()
  const view = await manager.view()
  expect(view.runtime).toEqual({ ready: true, error: null })
  expect(view.connections.map(item => [item.provider, item.account, item.state])).toEqual([['openape', 'patrick@example.invalid', 'ready'], ['chatgpt', 'model@example.invalid', 'ready']])
  expect(view.owner).toBe(rows.owner)
  expect(control.connections.metadata(rows.owner).pods).toEqual({ [pods[1].id]: bindings.owner, [pods[2].id]: bindings.duplicate })
  expect((await manager.podConnection(pods[2].id)).identity).toEqual(bindings.duplicate.identity)
  expect(resources.list(pods[2].id)[0]).toMatchObject({ state: 'ready', configuration: { ownerConnection: rows.owner } })
  expect(resources.list(pods[0].id)[0].state).toBe('revoked')
  const file = async (id: string) => await exists(join(root, 'credentials', `${id}.encrypted`)) || exists(join(root, 'credentials', `${id}.connection.json`))
  expect(await Promise.all([bindings.owner, bindings.duplicate].map(item => exists(join(root, 'credentials', `${item.connectionId}.identity.json`))))).toEqual([true, true])
  expect(await Promise.all([bindings.owner, bindings.duplicate].map(item => file(item.connectionId)))).toEqual([false, false])
  expect(await file(bindings.delta.connectionId)).toBe(false)
  expect(await exists(join(root, 'credentials', `${bindings.delta.connectionId}.identity.json`))).toBe(false)
  expect(await Promise.all([rows.owner, rows.codex].map(file))).toEqual([true, false])
  expect(await exists(join(root, 'credentials', `${rows.codex}.credential.json`))).toBe(true)
  expect(await Promise.all([rows.deltaReady, rows.deltaFailed, rows.ownerDuplicate, rows.codexFailed].map(file))).toEqual([false, false, false, false])
  expect(provision).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled()
  await manager.stop()

  const before = JSON.stringify(control.connections.metadata(rows.owner))
  const again = await start()
  expect((await again.view()).connections).toHaveLength(2)
  expect(JSON.stringify(control.connections.metadata(rows.owner))).toBe(before)
  await again.stop()
})
