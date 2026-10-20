// @vitest-environment node
import { access, mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { PodIdentityBindingError, PodIdentityManager } from '../../src/main/connections/agent'
import { OwnerConnection } from '../../src/main/connections/owner'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ConnectionManager } from '../../src/main/connections/manager'
import { CredentialCache } from '../../src/main/connections/cache'
import { CodexConnection } from '../../src/main/connections/codex'
import { AuthProcess } from '../../src/main/connections/process'
import { PodDatabase, digest } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { SetupControl } from '../../src/worker/onboarding/control'

const cleanups: (() => Promise<void>)[] = []
vi.mock('../../src/main/connections/broker', async original => ({ ...await original<typeof import('../../src/main/connections/broker')>(), podBrokerReceipt: vi.fn(async () => 'synthetic-receipt') }))
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs() })
async function fixture(architecture = process.arch, jevKey?: () => string | undefined, directAgents = false) {
  const root = await mkdtemp(join(tmpdir(), 'pods-connect-')); const vendor = join(root, 'vendor'); await mkdir(vendor)
  await writeFile(join(vendor, 'codex'), 'synthetic-codex')
  await writeFile(join(vendor, 'manifest.json'), JSON.stringify({ sdk: '0.153.4', cli: `0.153.4-${process.platform}-${architecture}`, binaryHash: digest('synthetic-codex') }))
  const store = new PodDatabase(root); const registry = new ResourceRegistry(store, () => {}); const control = new SetupControl(store, registry)
  const credentials = new CredentialCache(join(root, 'credentials'))
  const runtime = { helper: 'unused-fixture-helper', executable: process.execPath, entry: 'unused-entry', runtimeDirectories: [], environment: {}, binary: join(vendor, 'codex'), manifest: join(vendor, 'manifest.json'), catalog: 'unused-catalog', sdkHost: 'unused-host' }
  const availability = vi.fn(async () => {})
  const manager = new ConnectionManager(root, runtime, credentials, async command => control.execute(command), availability, async podId => store.getPod(podId).name, directAgents, jevKey)
  cleanups.push(async () => { await manager.stop(); store.close(); await rm(root, { recursive: true, force: true }) })
  await manager.initialize(async () => {})
  return { root, manager, store, control, credentials, availability, runtime }
}
async function namedBrokerFixture(registeredName?: string) {
  const context = await fixture(); const pod = context.store.createPod({ name: 'Invoice review' })
  const owner = randomUUID(); const account = 'owner@example.invalid'; const issuer = 'https://id.example.invalid'
  const broker = { issuer: 'https://pods.example.invalid', approvalHistory: 'pods.example.invalid', connectionId: randomUUID() }
  const identity = { connectionId: randomUUID(), podId: pod.id, issuer: broker.issuer, decisionIssuer: issuer, brokerConnectionId: broker.connectionId, owner: account, subject: 'pod@pods.example.invalid', keyId: 'existing-key' }
  context.control.execute({ type: 'save', connection: { id: owner, provider: 'openape', account, state: 'ready', error: null }, metadata: { issuer, subject: account, broker, pods: { [pod.id]: { connectionId: identity.connectionId, prepared: true, broker, identity, ...(registeredName === undefined ? {} : { registeredName }) } } } })
  const bearer = vi.spyOn(OwnerConnection.prototype, 'bearer').mockResolvedValue('synthetic-owner-token')
  return { ...context, pod, owner, account, issuer, broker, identity, bearer }
}

it('registers the normalized saved title once and refreshes only a changed broker name', async () => {
  const { manager, control, store, pod, owner, identity, bearer } = await namedBrokerFixture()
  const provision = vi.spyOn(PodIdentityManager.prototype, 'provision').mockImplementation(async (_id, name) => ({ identity, registeredName: name }))
  const prepare = vi.spyOn(PodIdentityManager.prototype, 'ensurePrepared'); const create = vi.spyOn(PodIdentityManager.prototype, 'prepare')
  expect((await manager.podConnection(pod.id)).identity).toEqual(identity)
  expect(provision).toHaveBeenCalledWith(identity.connectionId, 'Invoice review', 'synthetic-owner-token', 'synthetic-receipt', identity)
  await manager.podConnection(pod.id)
  expect(provision).toHaveBeenCalledOnce(); expect(bearer).toHaveBeenCalledOnce()
  const renamed = store.updatePod(pod.id, pod.revision, { name: '  Cafe\u0301\u200B review  ', lifecycle: 'paused' })
  await Promise.all([manager.podConnection(pod.id), manager.podConnection(pod.id)])
  expect(provision).toHaveBeenCalledTimes(2); expect(bearer).toHaveBeenCalledTimes(2)
  expect(provision.mock.calls[1][1]).toBe('Café review')
  const entry = (control.connections.metadata(owner).pods as Record<string, { identity: unknown, registeredName: string }>)[pod.id]
  expect(entry).toMatchObject({ identity, registeredName: 'Café review' })
  store.updatePod(pod.id, renamed.revision, { name: 'Café review', lifecycle: 'paused' })
  await manager.podConnection(pod.id); expect(provision).toHaveBeenCalledTimes(2)
  expect(prepare).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled()
})

it.each([undefined, 'A different title'])('keeps an unconfirmed provider name uncached and throttles retries (%s)', async (confirmed) => {
  const { manager, control, pod, owner, identity, bearer } = await namedBrokerFixture()
  const provision = vi.spyOn(PodIdentityManager.prototype, 'provision').mockResolvedValue({ identity, ...(confirmed === undefined ? {} : { registeredName: confirmed }) })
  await manager.podConnection(pod.id); await manager.podConnection(pod.id)
  expect(provision).toHaveBeenCalledOnce(); expect(bearer).toHaveBeenCalledOnce()
  expect((control.connections.metadata(owner).pods as Record<string, unknown>)[pod.id]).not.toHaveProperty('registeredName')
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 60001)
  provision.mockResolvedValue({ identity, registeredName: pod.name })
  await manager.podConnection(pod.id); await manager.podConnection(pod.id)
  expect(provision).toHaveBeenCalledTimes(2)
  expect((control.connections.metadata(owner).pods as Record<string, unknown>)[pod.id]).toMatchObject({ identity, registeredName: pod.name })
})

it('retains a working broker identity and retries a failed name refresh without changing grants', async () => {
  const { manager, control, pod, owner, identity, bearer } = await namedBrokerFixture('Earlier name')
  const provision = vi.spyOn(PodIdentityManager.prototype, 'provision').mockRejectedValue(new Error('Synthetic network failure'))
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect((await manager.podConnection(pod.id)).identity).toEqual(identity)
  expect((await manager.podConnection(pod.id)).identity).toEqual(identity)
  expect(provision).toHaveBeenCalledOnce(); expect(bearer).toHaveBeenCalledOnce(); expect(diagnostic).toHaveBeenCalledOnce()
  expect((control.connections.metadata(owner).pods as Record<string, unknown>)[pod.id]).toMatchObject({ identity, registeredName: 'Earlier name' })
})

it('keeps binding failures closed on the immediate retry instead of treating them as name failures', async () => {
  const { manager, pod, identity, bearer } = await namedBrokerFixture()
  const provision = vi.spyOn(PodIdentityManager.prototype, 'provision').mockRejectedValue(new PodIdentityBindingError('Pod identity cache binding mismatch'))
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(manager.podConnection(pod.id)).rejects.toBeInstanceOf(PodIdentityBindingError)
  await expect(manager.podConnection(pod.id)).rejects.toBeInstanceOf(PodIdentityBindingError)
  expect(provision).toHaveBeenCalledTimes(2); expect(bearer).toHaveBeenCalledTimes(2)
  expect(provision.mock.calls.every(call => call[4] === identity || JSON.stringify(call[4]) === JSON.stringify(identity))).toBe(true)
  expect(diagnostic).not.toHaveBeenCalled()
})

it('checks a changed owner binding even while a transport retry is throttled', async () => {
  const { manager, control, pod, owner, identity } = await namedBrokerFixture()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const provision = vi.spyOn(PodIdentityManager.prototype, 'provision').mockRejectedValue(new Error('Synthetic network failure'))
  await manager.podConnection(pod.id)
  const metadata = control.connections.metadata(owner)
  const pods = metadata.pods as Record<string, { identity: typeof identity }>; pods[pod.id].identity.owner = 'another@example.invalid'
  control.execute({ type: 'save', connection: { id: owner, provider: 'openape', account: identity.owner, state: 'ready', error: null }, metadata })
  await expect(manager.podConnection(pod.id)).rejects.toBeInstanceOf(PodIdentityBindingError)
  expect(provision).toHaveBeenCalledOnce()
})

it('uses the actual title for new direct identities without refreshing established direct registrations', async () => {
  const { manager, control, store } = await fixture(process.arch, undefined, true)
  const pod = store.createPod({ name: 'Direct invoice review' }); const owner = randomUUID()
  const issuer = 'https://id.example.invalid'; const account = 'owner@example.invalid'
  control.execute({ type: 'save', connection: { id: owner, provider: 'openape', account, state: 'ready', error: null }, metadata: { issuer, subject: account } })
  vi.spyOn(PodIdentityManager.prototype, 'ensurePrepared').mockResolvedValue()
  const provision = vi.spyOn(PodIdentityManager.prototype, 'provision').mockImplementation(async (connectionId, name) => ({ identity: { connectionId, podId: pod.id, issuer, owner: account, subject: 'direct@example.invalid', keyId: 'direct-key' }, registeredName: name }))
  const bearer = vi.spyOn(OwnerConnection.prototype, 'bearer').mockResolvedValue('synthetic-owner')
  const first = await manager.podConnection(pod.id)
  expect(provision).toHaveBeenCalledWith(expect.any(String), pod.name, 'synthetic-owner', undefined)
  store.updatePod(pod.id, pod.revision, { name: 'Renamed direct Pod', lifecycle: 'paused' })
  expect((await manager.podConnection(pod.id)).identity).toEqual(first.identity)
  expect(provision).toHaveBeenCalledOnce(); expect(bearer).toHaveBeenCalledOnce()
  expect((control.connections.metadata(owner).pods as Record<string, unknown>)[pod.id]).toMatchObject({ registeredName: pod.name })
})
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
it('opens an MCP session sign-in only for the registered owner subject and never changes the stored connection', async () => {
  const { manager, control } = await fixture()
  const signal = new AbortController().signal; const present = vi.fn()
  const endsAt = Date.now() + 3600000
  await expect(manager.ownerSession(endsAt, signal, present)).rejects.toThrow('Sign in with your DDISA account on desktop first')
  const id = randomUUID(); const owner = { issuer: 'https://id.example.invalid', subject: 'stable-owner' }
  control.execute({ type: 'save', connection: { id, provider: 'openape', account: 'owner@example.invalid', state: 'ready', error: null }, metadata: owner })
  const foreign = { subject: 'another-subject', close: vi.fn() }; const registered = { subject: 'stable-owner', close: vi.fn() }
  const verify = vi.spyOn(OwnerConnection.prototype, 'session').mockResolvedValueOnce(foreign as never).mockResolvedValueOnce(registered as never)
  const login = vi.spyOn(OwnerConnection.prototype, 'login')
  await expect(manager.ownerSession(endsAt, signal, present)).rejects.toThrow('not the registered owner')
  expect(foreign.close).toHaveBeenCalledOnce()
  await expect(manager.ownerSession(endsAt, signal, present)).resolves.toBe(registered)
  expect(verify).toHaveBeenCalledWith(owner.issuer, 'owner@example.invalid', endsAt, signal, present)
  expect(login).not.toHaveBeenCalled()
  expect(control.connections.metadata(id)).toEqual(owner)
})
it('rejects global Microsoft setup without touching its cache or starting login', async () => {
  const { manager } = await fixture()
  await expect(manager.execute({ type: 'connect', provider: 'microsoft', account: 'mail@example.invalid' })).rejects.toThrow('Permissions')
  expect((await manager.view()).connections).toHaveLength(0)
})
it('fails visibly for a mismatched runtime architecture', async () => {
  const wrong = await fixture(process.arch === 'x64' ? 'arm64' : 'x64')
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
  expect((await manager.podConnection(existing.id, { issuer, subject: account }, true)).identity).toEqual(identity)
  const broker = { issuer: 'https://pods.example.invalid', approvalHistory: 'pods.example.invalid', connectionId: randomUUID() }
  const provision = vi.spyOn(PodIdentityManager.prototype, 'provision').mockImplementation(async connectionId => ({ identity: { ...identity, connectionId, podId: fresh.id, issuer: 'https://pods.example.invalid', decisionIssuer: issuer, brokerConnectionId: broker.connectionId } }))
  await expect(manager.podConnection(fresh.id)).rejects.toThrow('Allow Pods to create agents')
  expect(provision).not.toHaveBeenCalled()
  control.execute({ type: 'save', connection: { id: owner, provider: 'openape', account, state: 'ready', error: null }, metadata: { ...control.connections.metadata(owner), broker } })
  await expect(manager.podConnection(fresh.id, { issuer, subject: account }, true)).rejects.toThrow('Prepare and approve this Pod identity')
  expect(provision).not.toHaveBeenCalled()
  const bearer = vi.spyOn(OwnerConnection.prototype, 'bearer').mockResolvedValue('synthetic')
  vi.spyOn(PodIdentityManager.prototype, 'ensurePrepared').mockResolvedValue()
  const before = (await manager.view()).connections
  expect((await manager.podConnection(fresh.id)).ownerConnection).toBe(owner)
  expect(bearer).toHaveBeenCalledWith(owner, issuer, account, expect.any(AbortSignal))
  expect(provision).toHaveBeenCalledWith(expect.any(String), fresh.name, 'synthetic', 'synthetic-receipt')
  await manager.podConnection(fresh.id)
  expect(provision).toHaveBeenCalledOnce(); expect(bearer).toHaveBeenCalledOnce()
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
  control.execute({ type: 'save', connection: { id, provider: 'openape', account: 'first@example.invalid', state: 'ready', error: null }, metadata: { issuer: 'https://id.example.invalid', subject: 'first@example.invalid', broker: { issuer: 'https://pods.example.invalid', approvalHistory: 'pods.example.invalid', connectionId: randomUUID() }, pods: { [pod.id]: { connectionId, prepared: true } } } })
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
  const metadata = { issuer: identity.decisionIssuer, privateMetadata: 'must-not-leak', broker: { issuer: 'https://new-pods.example.invalid', approvalHistory: 'new-pods.example.invalid', connectionId: randomUUID() }, pods: { [existing.id]: { connectionId: identity.connectionId, prepared: true, identity } } }
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

it('preserves a working TypeSafe key on failed replacement, hides it and erases it on disconnect', async () => {
  const { manager, credentials, store } = await fixture()
  const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ models: [{ name: 'jev-stable' }] }))
  const connected = await manager.execute({ type: 'saveTypesafe', key: 'synthetic-private-key' })
  const item = connected.connections.find(item => item.provider === 'typesafe')!
  expect(item).toMatchObject({ state: 'ready', account: 'TypeSafe / Jev' })
  expect(await credentials.readConnection(item.id)).toEqual({ kind: 'typesafe', key: 'synthetic-private-key' })
  expect(await manager.providerReady()).toBe(false)
  expect(JSON.stringify(connected)).not.toContain('synthetic-private-key')
  expect(JSON.stringify(store.db.prepare('SELECT * FROM connections').all())).not.toContain('synthetic-private-key')
  transport.mockResolvedValueOnce(new Response('synthetic-private-key', { status: 401 }))
  await expect(manager.execute({ type: 'saveTypesafe', key: 'wrong-replacement' })).rejects.toThrow('API key is invalid')
  expect(await credentials.readConnection(item.id)).toMatchObject({ key: 'synthetic-private-key' })
  expect((await manager.view()).connections.find(connection => connection.id === item.id)?.state).toBe('ready')
  transport.mockResolvedValueOnce(Response.json({ model: 'jev-1.13.0', echo: 'synthetic-private-key' }))
  await expect(manager.typesafeRequest(item.id, '{}', new AbortController().signal)).rejects.toThrow('exposed authentication data')
  transport.mockResolvedValueOnce(Response.json({ models: [{ name: 'jev-stable' }] }))
  expect((await manager.execute({ type: 'saveTypesafe', key: 'new-private-key' })).connections.find(connection => connection.provider === 'typesafe')?.id).toBe(item.id)
  expect(await credentials.readConnection(item.id)).toMatchObject({ key: 'new-private-key' })
  await manager.execute({ type: 'disconnect', id: item.id })
  await expect(credentials.readConnection(item.id)).rejects.toThrow()
  await expect(manager.typesafeRequest(item.id, '{}', new AbortController().signal)).rejects.toThrow('not connected')
})

it('aborts a live TypeSafe request on disconnect and marks rejected credentials expired', async () => {
  const { manager } = await fixture()
  const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ models: [{ name: 'jev-stable' }] }))
  const id = (await manager.execute({ type: 'saveTypesafe', key: 'synthetic-key' })).connections[0].id
  transport.mockImplementationOnce(async (_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true })))
  const pending = manager.typesafeRequest(id, '{}', new AbortController().signal)
  const rejected = expect(pending).rejects.toThrow('connection removed')
  await expect.poll(() => transport.mock.calls.length).toBe(2)
  await manager.execute({ type: 'disconnect', id }); await rejected
  transport.mockResolvedValueOnce(Response.json({ models: [{ name: 'jev-stable' }] }))
  await manager.execute({ type: 'saveTypesafe', key: 'another-key' })
  transport.mockResolvedValueOnce(new Response('another-key', { status: 403 }))
  const response = await manager.typesafeRequest(id, '{}', new AbortController().signal); await response.body?.cancel()
  expect((await manager.view()).connections[0]).toMatchObject({ state: 'expired', error: 'TypeSafe API key is invalid or access was denied; reconnect' })
})

/** A stand-in for the bundled Codex app-server: answers `model/list` (Codex 0.153.4 shape) over two pages. */
function fakeAppServer() {
  const server = { default: 'fixture-model-a' as string | null, starts: 0, requests: [] as { method: string, params: unknown }[] }
  vi.spyOn(AuthProcess, 'start').mockImplementation(async () => {
    server.starts++
    return {
      initialized: () => {},
      close: async () => {},
      request: async (method: string, params: unknown) => {
        server.requests.push({ method, params })
        if (method === 'initialize') return {}
        if (method !== 'model/list') throw new Error(`Unexpected ${method}`)
        if ((params as { cursor: string | null }).cursor === null) return { data: [{ id: 'fixture-small', model: 'fixture-small', isDefault: false, hidden: false }], nextCursor: 'page-2' }
        return { data: server.default ? [{ id: server.default, model: server.default, isDefault: true, hidden: false }] : [], nextCursor: null }
      },
    } as unknown as AuthProcess
  })
  return server
}
async function connectedChatGPT() {
  const context = await fixture()
  vi.spyOn(CodexConnection.prototype, 'login').mockResolvedValue({ account: 'model@example.invalid', accountId: 'synthetic-account' })
  const id = (await context.manager.execute({ type: 'connect', provider: 'chatgpt', account: '' })).connections[0].id
  await expect.poll(async () => (await context.manager.view()).connections[0].state).toBe('ready')
  await context.credentials.connect(id, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', account_id: 'synthetic-account' } }))
  return { ...context, id }
}
it('uses the account default from the app-server model list, caches it hourly and re-reads it after sign-in', async () => {
  const server = fakeAppServer(); const { manager } = await connectedChatGPT(); const signal = new AbortController().signal
  expect(await manager.model(signal)).toBe('fixture-model-a')
  expect(server.requests.filter(item => item.method === 'model/list').map(item => item.params)).toEqual([{ cursor: null, includeHidden: false }, { cursor: 'page-2', includeHidden: false }])
  server.default = 'fixture-model-b'
  expect(await manager.model(signal)).toBe('fixture-model-a')
  expect(server.starts).toBe(1)
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 61 * 60 * 1000)
  expect(await manager.model(signal)).toBe('fixture-model-b')
  expect(server.starts).toBe(2)
  server.default = 'fixture-model-c'
  await manager.execute({ type: 'connect', provider: 'chatgpt', account: '' })
  await expect.poll(async () => (await manager.view()).connections[0].state).toBe('ready')
  expect(await manager.model(signal)).toBe('fixture-model-c')
})
it('reads the account default again once after the provider refuses the cached model', async () => {
  const server = fakeAppServer(); const { manager } = await connectedChatGPT(); const signal = new AbortController().signal
  vi.spyOn(CodexConnection.prototype, 'bearer').mockResolvedValue('synthetic-bearer')
  const refusal = (model: string) => JSON.stringify({ detail: `The '${model}' model is not supported when using Codex with a ChatGPT account.` })
  const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => new Response(refusal(JSON.parse(String(init?.body)).model), { status: 400, headers: { 'Content-Type': 'application/json' } }))
  expect(await manager.model(signal)).toBe('fixture-model-a')
  const response = await manager.provider({ model: 'fixture-model-a' }, signal)
  expect(response.status).toBe(400); expect(await response.text()).toBe(refusal('fixture-model-a'))
  server.default = 'fixture-model-b'
  expect(await manager.model(signal)).toBe('fixture-model-b')
  await manager.provider({ model: 'fixture-model-b' }, signal)
  server.default = 'fixture-model-c'
  expect(await manager.model(signal)).toBe('fixture-model-b')
  expect(server.starts).toBe(2); expect(upstream).toHaveBeenCalledTimes(2)
})
it('fails visibly when the account reports no default model', async () => {
  const server = fakeAppServer(); const { manager } = await connectedChatGPT()
  server.default = null
  await expect(manager.model(new AbortController().signal)).rejects.toThrow('The connected ChatGPT account reports no default model')
})

it('uses an explicit CLI Jev key without decrypting or replacing desktop credentials', async () => {
  const { manager, control, credentials } = await fixture(process.arch, () => 'synthetic-env-key')
  const id = randomUUID()
  control.execute({ type: 'save', connection: { id, provider: 'typesafe', account: 'TypeSafe / Jev', state: 'ready', error: null }, metadata: {} })
  const read = vi.spyOn(credentials, 'readConnection')
  const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ result: 'synthetic-result' }))
  expect(await (await manager.typesafeRequest(id, '{}', new AbortController().signal)).json()).toEqual({ result: 'synthetic-result' })
  expect(transport).toHaveBeenCalledWith('https://api.typesafe.ai/v1/systemone', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer synthetic-env-key' }) }))
  expect(read).not.toHaveBeenCalled()
  transport.mockResolvedValueOnce(new Response('rejected', { status: 401 }))
  expect((await manager.typesafeRequest(id, '{}', new AbortController().signal)).status).toBe(401)
  expect((await manager.view()).connections.find(item => item.id === id)?.state).toBe('ready')
  transport.mockResolvedValueOnce(Response.json({ echo: 'synthetic-env-key' }))
  await expect(manager.typesafeRequest(id, '{}', new AbortController().signal)).rejects.toThrow('exposed authentication data')
  const cancelled = new AbortController(); cancelled.abort()
  const count = transport.mock.calls.length
  await expect(manager.typesafeRequest(id, '{}', cancelled.signal)).rejects.toThrow()
  expect(transport).toHaveBeenCalledTimes(count)
  await manager.execute({ type: 'disconnect', id })
  await expect(manager.typesafeRequest(id, '{}', new AbortController().signal)).rejects.toThrow('not connected')
  expect(transport).toHaveBeenCalledTimes(count)
})

it('uses one migrated ChatGPT cache from a cipherless runtime, saves refreshed tokens and removes it on disconnect', async () => {
  const server = fakeAppServer()
  const { root, manager, credentials, runtime, id } = await connectedChatGPT()
  expect(await manager.model(new AbortController().signal)).toBe('fixture-model-a')
  const cliCache = new CredentialCache(join(root, 'credentials'))
  const cliConnection = new CodexConnection(cliCache, runtime, join(root, 'authentication'))
  server.default = 'fixture-cli-model'
  expect(await cliConnection.defaultModel(id, 'synthetic-account', new AbortController().signal)).toBe('fixture-cli-model')
  const futureToken = `synthetic.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`
  await cliCache.withCache(id, async (file) => {
    const value = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...value, tokens: { ...value.tokens, access_token: futureToken, refresh_token: 'synthetic-refreshed-token' } }))
  })
  expect(await cliConnection.bearer(id, 'synthetic-account', new AbortController().signal)).toBe(futureToken)
  expect(await credentials.readConnection(id)).toMatchObject({ tokens: { refresh_token: 'synthetic-refreshed-token' } })
  await expect(cliConnection.bearer(id, 'foreign', new AbortController().signal)).rejects.toThrow('binding')
  await manager.execute({ type: 'disconnect', id })
  await expect(cliCache.readConnection(id)).rejects.toThrow()
  await expect(manager.model(new AbortController().signal)).rejects.toThrow('Connect ChatGPT')
})

it('refreshes ChatGPT through the cipherless controller and preserves the newest token for desktop reuse', async () => {
  const { root, credentials, runtime, id } = await connectedChatGPT()
  const token = (expiry: number) => `synthetic.${Buffer.from(JSON.stringify({ exp: expiry })).toString('base64url')}.signature`
  await credentials.connect(id, JSON.stringify({ tokens: { account_id: 'synthetic-account', access_token: token(1), refresh_token: 'old-synthetic-refresh' } }))
  await credentials.migrateChatgpt(id, 'synthetic-account')
  const refreshed = token(Math.floor(Date.now() / 1000) + 3600)
  vi.spyOn(AuthProcess, 'start').mockImplementation(async (_runtime, _root, _binary, _argv, home) => ({
    initialized: () => {},
    close: async () => {},
    request: async (method: string) => {
      if (method === 'initialize') return {}
      if (method !== 'account/read') throw new Error(`Unexpected ${method}`)
      await writeFile(join(home, 'auth.json'), JSON.stringify({ tokens: { account_id: 'synthetic-account', access_token: refreshed, refresh_token: 'new-synthetic-refresh' } }))
      return { account: { type: 'chatgpt' } }
    },
  }) as unknown as AuthProcess)
  const cli = new CodexConnection(new CredentialCache(join(root, 'credentials')), runtime, join(root, 'authentication'))
  expect(await cli.bearer(id, 'synthetic-account', new AbortController().signal)).toBe(refreshed)
  expect(await credentials.readConnection(id)).toMatchObject({ tokens: { access_token: refreshed, refresh_token: 'new-synthetic-refresh' } })
})

// Issue 1519: the owner token comes only from the owner's apes (DDISA) login in ~/.config/apes.
it('uses only the matching apes login for the owner token', async () => {
  const { manager, account, issuer, bearer } = await namedBrokerFixture()
  const jwt = (sub: string) => `header.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.signature`
  const login = (token: () => Promise<{ issuer: string, accessToken: string } | null>, signedIn = true) => ({ signedIn: vi.fn(() => signedIn), token: vi.fn(token) })
  const signal = new AbortController().signal
  const apes = login(async () => ({ issuer, accessToken: jwt(account) }))
  expect(await manager.ownerBearer(signal, apes)).toBe(jwt(account))
  expect(apes.signedIn).toHaveBeenCalledWith(issuer, account)
  await expect(manager.ownerBearer(signal, login(async () => { throw new Error('The apes access token expired') }))).rejects.toThrow('expired')
  for (const other of [login(async () => ({ issuer, accessToken: jwt('someone-else') })), login(async () => ({ issuer: 'https://other.example.invalid', accessToken: jwt(account) })), login(async () => null, false)]) {
    await expect(manager.ownerBearer(signal, other)).rejects.toThrow('Log in with apes')
  }
  expect(bearer).not.toHaveBeenCalled()
})
