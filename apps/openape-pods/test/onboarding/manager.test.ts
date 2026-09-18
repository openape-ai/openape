// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { PodIdentityManager } from '../../src/main/connections/agent'
import { OwnerConnection } from '../../src/main/connections/owner'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ConnectionManager } from '../../src/main/connections/manager'
import { CredentialCache } from '../../src/main/connections/cache'
import { CodexConnection } from '../../src/main/connections/codex'
import { PodDatabase, digest } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { SetupControl } from '../../src/worker/onboarding/control'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks() })
async function fixture(locked = false, architecture = process.arch) {
  const root = await mkdtemp(join(tmpdir(), 'pods-connect-')); const vendor = join(root, 'vendor'); await mkdir(vendor)
  await writeFile(join(vendor, 'codex'), 'synthetic-codex')
  await writeFile(join(vendor, 'manifest.json'), JSON.stringify({ cli: `0.153.4-${process.platform}-${architecture}`, binaryHash: digest('synthetic-codex') }))
  const store = new PodDatabase(root); const registry = new ResourceRegistry(store, () => {}); const control = new SetupControl(store, registry)
  const credentials = new CredentialCache(join(root, 'credentials'), { available: () => !locked, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
  const runtime = { helper: 'unused-fixture-helper', executable: process.execPath, entry: 'unused-entry', runtimeDirectories: [], environment: {}, binary: join(vendor, 'codex'), manifest: join(vendor, 'manifest.json'), catalog: 'unused-catalog', sdkHost: 'unused-host' }
  const availability = vi.fn(async () => {})
  const manager = new ConnectionManager(root, runtime, credentials, async command => control.execute(command), availability)
  cleanups.push(async () => { await manager.stop(); store.close(); await rm(root, { recursive: true, force: true }) })
  await manager.initialize(async () => {})
  return { manager, store, control, credentials, availability }
}
it('records explicit sign-in cancellation and supports a separate retry without auto-activating work', async () => {
  vi.spyOn(CodexConnection.prototype, 'login').mockImplementation(async (_id, signal, present) => { present({ url: 'https://auth.openai.com/device', code: 'SYNTHETIC' }); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })) })
  const { manager, store } = await fixture()
  const started = await manager.execute({ type: 'connect', provider: 'chatgpt', account: '' }); const id = started.connections[0].id
  await expect.poll(async () => (await manager.view()).connections[0].login?.code).toBe('SYNTHETIC')
  const cancelled = await manager.execute({ type: 'cancel', id })
  expect(cancelled.connections[0]).toMatchObject({ state: 'failed', error: 'Cancelled', login: null })
  vi.spyOn(CodexConnection.prototype, 'login').mockResolvedValue({ account: 'model@example.invalid', accountId: 'synthetic-account' })
  await manager.execute({ type: 'connect', provider: 'chatgpt', account: '' })
  await expect.poll(async () => (await manager.view()).connections[1].state).toBe('ready')
  expect(await manager.providerReady()).toBe(true); expect(store.listPods()).toEqual([])
  expect((await manager.view()).complete).toBe(false)
  await manager.execute({ type: 'disconnect', id: (await manager.view()).connections[1].id }); expect(await manager.providerReady()).toBe(false)
})
it('rejects global Microsoft setup without touching its cache or starting login', async () => {
  const { manager } = await fixture()
  await expect(manager.execute({ type: 'connect', provider: 'microsoft', account: 'mail@example.invalid' })).rejects.toThrow('Permissions')
  expect((await manager.view()).connections).toHaveLength(0)
})
it('fails visibly for a locked credential store and mismatched runtime architecture', async () => {
  const locked = await fixture(true)
  await expect(locked.manager.execute({ type: 'connect', provider: 'chatgpt', account: '' })).rejects.toThrow('locked')
  expect((await locked.manager.view()).connections).toHaveLength(0)
  const wrong = await fixture(false, process.arch === 'x64' ? 'arm64' : 'x64')
  expect((await wrong.manager.view()).runtime).toMatchObject({ ready: false, error: 'Bundled Codex architecture does not match this Mac' })
  await expect(wrong.manager.execute({ type: 'connect', provider: 'chatgpt', account: '' })).rejects.toThrow('architecture')
})

it('keeps an existing pod owner while new pods use the most recently connected account', async () => {
  const { manager, control, store } = await fixture()
  const existing = store.createPod({ name: 'Existing' }); const fresh = store.createPod({ name: 'New' })
  const first = randomUUID(); const second = randomUUID()
  const identity = { connectionId: randomUUID(), podId: existing.id, issuer: 'https://id.example.invalid', owner: 'first@example.invalid', subject: 'pod@example.invalid', keyId: 'key' }
  for (const [id, account, pods] of [[first, identity.owner, { [existing.id]: { connectionId: identity.connectionId, prepared: true, identity } }], [second, 'second@example.invalid', {}]] as const) control.execute({ type: 'save', connection: { id, provider: 'openape', account, state: 'ready', error: null }, metadata: { issuer: identity.issuer, pods } })
  expect((await manager.podConnection(existing.id)).identity).toEqual(identity)
  const bearer = vi.spyOn(OwnerConnection.prototype, 'bearer').mockResolvedValue('synthetic')
  vi.spyOn(PodIdentityManager.prototype, 'ensurePrepared').mockResolvedValue()
  vi.spyOn(PodIdentityManager.prototype, 'provision').mockImplementation(async connectionId => ({ ...identity, connectionId, podId: fresh.id, owner: 'second@example.invalid' }))
  expect((await manager.podConnection(fresh.id)).ownerConnection).toBe(second)
  expect(bearer).toHaveBeenCalledWith(second, identity.issuer, 'second@example.invalid', expect.any(AbortSignal))
  expect((await manager.podConnection(existing.id)).ownerConnection).toBe(first)
})
it('rejects ambiguous pod ownership without minting another identity', async () => {
  const { manager, control, store } = await fixture(); const pod = store.createPod({ name: 'Ambiguous' })
  for (const account of ['first@example.invalid', 'second@example.invalid']) control.execute({ type: 'save', connection: { id: randomUUID(), provider: 'openape', account, state: 'ready', error: null }, metadata: { issuer: 'https://id.example.invalid', pods: { [pod.id]: { prepared: false } } } })
  const provision = vi.spyOn(PodIdentityManager.prototype, 'provision')
  await expect(manager.podConnection(pod.id)).rejects.toThrow('multiple OpenApe accounts')
  expect(provision).not.toHaveBeenCalled()
})
