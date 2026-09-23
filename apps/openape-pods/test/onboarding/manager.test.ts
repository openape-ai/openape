// @vitest-environment node
import { access, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
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
vi.mock('../../src/main/connections/broker', async original => ({ ...await original<typeof import('../../src/main/connections/broker')>(), podBrokerReceipt: vi.fn(async () => 'synthetic-receipt') }))
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs() })
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
  return { root, manager, store, control, credentials, availability }
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
  await expect.poll(async () => (await manager.view()).connections[0].state).toBe('ready')
  expect((await manager.view()).connections).toHaveLength(1)
  expect(await manager.providerReady()).toBe(true); expect(store.listPods()).toEqual([])
  expect((await manager.view()).complete).toBe(false)
  await manager.execute({ type: 'disconnect', id }); expect(await manager.providerReady()).toBe(false)
})
it('keeps an opaque owner subject separate from its discovery email when enrolling existing Pods', async () => {
  const { manager, control, store } = await fixture()
  const pod = store.createPod({ name: 'Existing opaque-subject owner' })
  const id = randomUUID(); const account = 'human@example.test'
  const owner = { issuer: 'https://id.example', subject: 'stable-user-id' }
  const identity = { connectionId: randomUUID(), podId: pod.id, issuer: owner.issuer, owner: account, subject: 'pod@example.test', keyId: 'existing-key' }
  control.execute({ type: 'save', connection: { id, provider: 'openape', account, state: 'ready', error: null }, metadata: { ...owner, pods: { [pod.id]: { connectionId: identity.connectionId, prepared: true, identity } } } })
  expect(await manager.remoteOwner()).toEqual({ owner, email: account })
  expect(await manager.existingRemotePods(owner)).toEqual([{ podId: pod.id, identity }])
  expect(await manager.existingRemotePods({ ...owner, subject: account })).toEqual([])
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

it('uses the single owner for new pods, only through the Pods provider, without changing its account', async () => {
  const { manager, control, store } = await fixture()
  const existing = store.createPod({ name: 'Existing' }); const fresh = store.createPod({ name: 'New' })
  const owner = randomUUID(); const account = 'owner@example.invalid'; const issuer = 'https://id.example.invalid'
  const identity = { connectionId: randomUUID(), podId: existing.id, issuer, owner: account, subject: 'pod@example.invalid', keyId: 'key' }
  control.execute({ type: 'save', connection: { id: owner, provider: 'openape', account, state: 'ready', error: null }, metadata: { issuer, subject: account, pods: { [existing.id]: { connectionId: identity.connectionId, prepared: true, identity } } } })
  expect((await manager.podConnection(existing.id)).identity).toEqual(identity)
  const broker = { issuer: 'https://pods.example.invalid', domain: 'pods.example.invalid', connectionId: randomUUID() }
  const provision = vi.spyOn(PodIdentityManager.prototype, 'provision').mockImplementation(async connectionId => ({ ...identity, connectionId, podId: fresh.id, issuer: 'https://pods.example.invalid', decisionIssuer: issuer, brokerConnectionId: broker.connectionId }))
  await expect(manager.podConnection(fresh.id)).rejects.toThrow('Allow Pods to create agents')
  expect(provision).not.toHaveBeenCalled()
  control.execute({ type: 'save', connection: { id: owner, provider: 'openape', account, state: 'ready', error: null }, metadata: { ...control.connections.metadata(owner), broker } })
  const bearer = vi.spyOn(OwnerConnection.prototype, 'bearer').mockResolvedValue('synthetic')
  vi.spyOn(PodIdentityManager.prototype, 'ensurePrepared').mockResolvedValue()
  const before = (await manager.view()).connections
  expect((await manager.podConnection(fresh.id)).ownerConnection).toBe(owner)
  expect(bearer).toHaveBeenCalledWith(owner, issuer, account, expect.any(AbortSignal))
  expect((await manager.view()).connections).toEqual(before)
  await expect(manager.podConnection(fresh.id, { issuer, subject: 'someone-else' })).rejects.toThrow('another owner')
})

it('refuses Pod work while the owner must sign in again and keeps the binding for the same account', async () => {
  vi.stubEnv('DDISA_MOCK_RECORDS', JSON.stringify({ 'example.invalid': { idp: 'https://id.example.invalid' } }))
  const { manager, control, store } = await fixture(); const pod = store.createPod({ name: 'Bound' })
  const id = randomUUID()
  const identity = { connectionId: randomUUID(), podId: pod.id, issuer: 'https://id.example.invalid', owner: 'first@example.invalid', subject: 'agent@example.invalid', keyId: 'key' }
  const metadata = { issuer: identity.issuer, subject: identity.owner, pods: { [pod.id]: { connectionId: identity.connectionId, prepared: true, identity } } }
  control.execute({ type: 'save', connection: { id, provider: 'openape', account: identity.owner, state: 'expired', error: null }, metadata })
  const provision = vi.spyOn(PodIdentityManager.prototype, 'provision')
  await expect(manager.podConnection(pod.id)).rejects.toThrow('Sign in to your DDISA account again')
  const login = vi.spyOn(OwnerConnection.prototype, 'login').mockResolvedValue({ issuer: identity.issuer, subject: identity.owner })
  await manager.execute({ type: 'connect', provider: 'openape', account: 'First@Example.invalid' })
  await expect.poll(async () => (await manager.view()).connections[0].state).toBe('ready')
  expect(login).toHaveBeenCalledWith(id, identity.issuer, identity.owner, expect.any(AbortSignal), expect.any(Function))
  expect((await manager.podConnection(pod.id)).identity).toEqual(identity)
  expect((await manager.view()).connections).toHaveLength(1)
  expect(provision).not.toHaveBeenCalled()
})

it('switches the owner only after confirmation and releases pods bound to the previous identity', async () => {
  vi.stubEnv('DDISA_MOCK_RECORDS', JSON.stringify({ 'example.invalid': { idp: 'https://id.example.invalid' } }))
  const { root, manager, control, store, credentials } = await fixture(); const pod = store.createPod({ name: 'Bound' })
  const id = randomUUID(); const connectionId = randomUUID()
  await credentials.create(connectionId, JSON.stringify({ podId: pod.id, privateKey: 'synthetic-key' }))
  control.execute({ type: 'save', connection: { id, provider: 'openape', account: 'first@example.invalid', state: 'ready', error: null }, metadata: { issuer: 'https://id.example.invalid', subject: 'first@example.invalid', broker: { issuer: 'https://pods.example.invalid', domain: 'pods.example.invalid', connectionId: randomUUID() }, pods: { [pod.id]: { connectionId, prepared: true } } } })
  const login = vi.spyOn(OwnerConnection.prototype, 'login').mockRejectedValueOnce(new Error('Declined')).mockResolvedValue({ issuer: 'https://id.example.invalid', subject: 'second@example.invalid' })
  await expect(manager.execute({ type: 'connect', provider: 'openape', account: 'second@example.invalid' })).rejects.toThrow('Confirm switching')
  expect(login).not.toHaveBeenCalled()
  await manager.execute({ type: 'connect', provider: 'openape', account: 'second@example.invalid', switchAccount: true })
  await expect.poll(async () => (await manager.view()).connections[0].error).toBe('Declined')
  expect((await manager.view()).connections[0]).toMatchObject({ id, account: 'first@example.invalid', state: 'ready' })
  expect(control.connections.metadata(id).pods).toHaveProperty(pod.id)
  await manager.execute({ type: 'connect', provider: 'openape', account: 'second@example.invalid', switchAccount: true })
  await expect.poll(async () => (await manager.view()).connections[0].account).toBe('second@example.invalid')
  expect((await manager.view()).connections).toEqual([expect.objectContaining({ id, state: 'ready', error: null })])
  expect(control.connections.metadata(id)).toEqual({ issuer: 'https://id.example.invalid', subject: 'second@example.invalid' })
  await expect(access(join(root, 'credentials', `${connectionId}.encrypted`))).rejects.toThrow('ENOENT')
})

it('discovers the identity provider from the DDISA record of the email domain', async () => {
  vi.stubEnv('DDISA_MOCK_RECORDS', JSON.stringify({ 'published.invalid': { idp: 'https://idp.published.invalid' }, 'plain.invalid': { idp: 'http://idp.plain.invalid' } }))
  const { manager } = await fixture()
  const login = vi.spyOn(OwnerConnection.prototype, 'login').mockResolvedValue({ issuer: 'https://idp.published.invalid', subject: 'owner' })
  await expect(manager.execute({ type: 'connect', provider: 'openape', account: 'owner@plain.invalid' })).rejects.toThrow('HTTPS origin')
  await manager.execute({ type: 'connect', provider: 'openape', account: 'owner@published.invalid' })
  await expect.poll(async () => (await manager.view()).connections[0]?.state).toBe('ready')
  expect(login).toHaveBeenCalledWith(expect.any(String), 'https://idp.published.invalid', 'owner@published.invalid', expect.any(AbortSignal), expect.any(Function))
  expect((await manager.view()).owner).toBe((await manager.view()).connections[0].id)
})

it('reads a pod identity without creating credentials, changing owners or exposing private metadata', async () => {
  const { manager, control, store, credentials } = await fixture()
  const existing = store.createPod({ name: 'Existing' }); const fresh = store.createPod({ name: 'New' })
  const first = randomUUID(); const brokerId = randomUUID()
  const identity = { connectionId: randomUUID(), podId: existing.id, issuer: 'https://pods.example.invalid', decisionIssuer: 'https://id.example.invalid', owner: 'original@example.invalid', subject: 'agent@pods.example.invalid', keyId: 'private-metadata-key', brokerConnectionId: brokerId }
  const metadata = { issuer: identity.decisionIssuer, privateMetadata: 'must-not-leak', broker: { issuer: 'https://new-pods.example.invalid', domain: 'new-pods.example.invalid', connectionId: randomUUID() }, pods: { [existing.id]: { connectionId: identity.connectionId, prepared: true, identity } } }
  control.execute({ type: 'save', connection: { id: first, provider: 'openape', account: identity.owner, state: 'revoked', error: null }, metadata })
  const create = vi.spyOn(credentials, 'create'); const provision = vi.spyOn(PodIdentityManager.prototype, 'provision')
  const view = await manager.execute({ type: 'list', podId: existing.id })
  expect(view.podIdentity).toEqual({ podId: existing.id, bound: true, ownerConnection: first, issuer: identity.issuer, decisionIssuer: identity.decisionIssuer, subject: identity.subject, brokerConnectionId: brokerId })
  expect(JSON.stringify(view)).not.toMatch(/must-not-leak|private-metadata-key/)
  expect((await manager.execute({ type: 'list', podId: fresh.id })).podIdentity).toMatchObject({ bound: false, ownerConnection: first, issuer: 'https://new-pods.example.invalid', subject: null })
  expect((await manager.execute({ type: 'list' })).podIdentity).toBeUndefined()
  expect(create).not.toHaveBeenCalled(); expect(provision).not.toHaveBeenCalled()
  expect(control.connections.metadata(first)).toEqual(metadata)
})
