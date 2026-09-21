// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { generateKey, publicKey } from '@openape/pods-protocol/crypto'
import type { Owner, Route } from '@openape/pods-protocol'
import { PodDatabase } from '../../src/worker/storage/database'
import { RemoteControl } from '../../src/worker/remote/control'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { MasterControl } from '../../src/worker/master/control'
import { MasterService } from '../../src/worker/master/service'
import { ChatRegistry } from '../../src/worker/master/chat-registry'
import type { AgentRuntime } from '../../src/worker/agent/executor'

const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })
async function fixture() {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-remote-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const runtime = {} as AgentRuntime
  const runs = new RunDispatcher(store, resources, runtime)
  const scheduler = new Scheduler(store, runs)
  const control = new MasterControl(store, resources, runs, scheduler, runtime)
  const master = new MasterService(store, runtime, control)
  const remote = new RemoteControl(store, master, runs, resources, scheduler)
  const owner: Owner = { issuer: 'https://id.example', subject: 'owner@example.test' }
  const registration = { id: randomUUID(), generation: randomUUID(), owner }
  const key = publicKey(generateKey())
  const device = { id: randomUUID(), owner, keys: { signing: key, agreement: key }, epoch: 1 }
  await remote.execute({ type: 'configure', registration }); await remote.execute({ type: 'pair', device })
  const route: Route = { protocol: 'pods-mobile', major: 1, minor: 0, id: randomUUID(), runtimeId: registration.id, generation: registration.generation, deviceId: device.id, keyEpoch: 1, owner, direction: 'command', kind: 'pod.create', kindVersion: 1, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), sequence: '0' }
  const command = { type: 'execute' as const, route, body: { name: 'Remote Pod' }, hash: 'a'.repeat(64), leaseUntil: new Date(Date.now() + 25000).toISOString() }
  return { store, remote, registration, device, owner, route, command, control, master, runs, resources, scheduler }
}
it('creates one paused Pod with durable ownership and the same local conversation', async () => {
  const { store, remote, command, owner } = await fixture()
  const first = await remote.execute(command)
  expect(await remote.execute(command)).toEqual(first)
  expect(store.listPods()).toHaveLength(1)
  const pod = store.listPods()[0]!
  expect(pod.lifecycle).toBe('paused')
  expect(JSON.parse(String(store.db.prepare('SELECT owner FROM remote_pods').get()?.owner))).toEqual(owner)
  const chat = new ChatRegistry(store).ensure(pod.id)
  expect(first).toMatchObject({ state: 'applied', podId: pod.id, conversationId: chat.id })
  expect(store.db.prepare('SELECT count(*) AS count FROM remote_outbox').get()?.count).toBe(1)
  await expect(remote.execute({ ...command, hash: 'b'.repeat(64) })).rejects.toThrow('operation_conflict')
})
it('rejects foreign issuers, unpaired devices and expired leases before local persistence', async () => {
  const { store, remote, command } = await fixture()
  await expect(remote.execute({ ...command, route: { ...command.route, owner: { ...command.route.owner, issuer: 'https://other.example' } } })).rejects.toThrow('remote_authorization_failed')
  await expect(remote.execute({ ...command, route: { ...command.route, deviceId: randomUUID() } })).rejects.toThrow('remote_authorization_failed')
  await expect(remote.execute({ ...command, leaseUntil: new Date(Date.now() - 1).toISOString() })).rejects.toThrow('dispatch_lease_expired')
  expect(store.listPods()).toEqual([])
})
it('filters model catalogue and refuses model creation and mixed-owner context', async () => {
  const { store, remote, command, control } = await fixture()
  await remote.execute(command)
  const mine = store.listPods()[0]!
  const other = store.createPod({ name: 'Other private Pod' })
  const chat = new ChatRegistry(store).ensure(mine.id)
  const result = await control.execute(randomUUID(), { action: 'list' }, new AbortController().signal, null, null, chat)
  expect(result).toMatchObject({ pods: [{ id: mine.id }], workflows: [] })
  expect(JSON.stringify(result)).not.toContain(other.name)
  await expect(control.execute(randomUUID(), { action: 'create', name: 'Unbound' }, new AbortController().signal, null, null, chat)).rejects.toThrow('desktop workspace')
  new ChatRegistry(store).execute({ type: 'context', id: chat.id, revision: 1, podIds: [mine.id, other.id], workflowId: null, workflowRevision: null })
  expect(await remote.execute({ ...command, route: { ...command.route, id: randomUUID(), direction: 'query', kind: 'conversation' }, body: { podId: mine.id, conversationId: chat.id } })).toMatchObject({ state: 'failed' })
  await expect(control.execute(randomUUID(), { action: 'list' }, new AbortController().signal, null, null, new ChatRegistry(store).get(chat.id))).rejects.toThrow('another owner')
})
it('retains the original result after a lost acknowledgement and rejects stale edits', async () => {
  const { store, remote, command } = await fixture()
  await remote.execute(command); const pod = store.listPods()[0]!
  await remote.execute({ type: 'ack', id: command.route.id })
  expect(await remote.execute({ type: 'outbox' })).toEqual([])
  expect(await remote.execute(command)).toMatchObject({ podId: pod.id })
  store.updatePod(pod.id, 1, { name: 'Changed on desktop', lifecycle: 'paused' })
  expect(await remote.execute({ ...command, route: { ...command.route, id: randomUUID(), kind: 'pod.rename' }, body: { podId: pod.id, name: 'Stale phone', expected: { podRevision: 1 } } })).toMatchObject({ state: 'failed' })
  expect(store.getPod(pod.id).name).toBe('Changed on desktop')
})
it('does not silently bind an existing local Pod to the default account', async () => {
  const { store, remote, command } = await fixture()
  const local = store.createPod({ name: 'Unclaimed local Pod' })
  expect(await remote.execute({ ...command, route: { ...command.route, direction: 'query', kind: 'run' }, body: { podId: local.id } })).toMatchObject({ state: 'failed' })
  expect(store.db.prepare('SELECT count(*) AS count FROM remote_pods').get()?.count).toBe(0)
})

it('requires new pairing after runtime registration changes without replacing Pod identity', async () => {
  const { store, remote, command, registration, owner } = await fixture()
  await remote.execute(command)
  const pod = store.listPods()[0]!
  const identity = { subject: 'existing-agent@example.test', keyId: 'existing-key' }
  await remote.execute({ type: 'provision', podId: pod.id, identity, error: null })
  const renewed = { ...registration, id: randomUUID(), generation: randomUUID() }
  await remote.execute({ type: 'configure', registration: renewed })
  expect(await remote.execute({ type: 'status' })).toMatchObject({ devices: [], registration: renewed })
  const binding = store.db.prepare('SELECT identity,runtime_id FROM remote_pods WHERE pod_id=?').get(pod.id)!
  expect(JSON.parse(String(binding.identity))).toEqual(identity)
  expect(binding.runtime_id).toBe(renewed.id)
  expect(await remote.execute({ type: 'outbox' })).toEqual([])
  await expect(remote.execute(command)).rejects.toThrow('remote_authorization_failed')
  await expect(remote.execute({ type: 'claim', podId: pod.id, owner, identity: { ...identity, keyId: 'different' } })).rejects.toThrow('pod_identity_conflict')
})

it('reconciles an acknowledged operation from desktop storage and persists rejected edits', async () => {
  const { store, remote, command } = await fixture()
  const created = await remote.execute(command)
  await remote.execute({ type: 'ack', id: command.route.id })
  const queryId = randomUUID()
  await remote.execute({ ...command, route: { ...command.route, id: queryId, direction: 'query', kind: 'operation' }, body: { operationId: command.route.id } })
  const saved = JSON.parse(String(store.db.prepare('SELECT result FROM remote_inbox WHERE id=?').get(queryId)?.result))
  expect(saved.data.receipt).toEqual(created)
  const pod = store.listPods()[0]!
  const invalid = { ...command, route: { ...command.route, id: randomUUID(), kind: 'pod.rename' as const }, body: { podId: pod.id, name: 'Stale edit', expected: { podRevision: 100 } } }
  const receipt = await remote.execute(invalid)
  expect(receipt).toMatchObject({ state: 'failed' })
  expect(await remote.execute(invalid)).toEqual(receipt)
  expect(store.getPod(pod.id).name).toBe('Remote Pod')
})

it('marks a command interrupted after journal commit as unknown and never re-applies it', async () => {
  const { store, command, master, runs, resources, scheduler } = await fixture()
  // Simulate a crash after the journal row was written but before the outcome was committed.
  store.db.prepare('INSERT INTO remote_inbox VALUES(?,?,?,?,\'received\',NULL,NULL,?)').run(command.route.id, command.hash, command.route.deviceId, JSON.stringify(command.route), Date.now())
  const restarted = new RemoteControl(store, master, runs, resources, scheduler)
  const receipt = await restarted.execute(command)
  expect(receipt).toMatchObject({ operationId: command.route.id, state: 'unknown', code: 'inspect_before_retry' })
  expect(await restarted.execute(command)).toMatchObject({ operationId: command.route.id, state: 'unknown', code: 'inspect_before_retry' })
  expect(store.listPods()).toEqual([])
  await expect(restarted.execute({ ...command, hash: 'c'.repeat(64) })).rejects.toThrow('operation_conflict')
})
it('refuses a run start whose approved script or resources changed since review', async () => {
  const { store, remote, command } = await fixture()
  await remote.execute(command); const pod = store.listPods()[0]!
  const stale = { ...command, route: { ...command.route, id: randomUUID(), kind: 'run.start' as const }, body: { podId: pod.id, expected: { podRevision: store.getPod(pod.id).revision, scriptHash: 'f'.repeat(64), resourceEpoch: 0 } } }
  const receipt = await remote.execute(stale)
  expect(receipt).toMatchObject({ state: 'failed' })
  expect(JSON.parse(String(store.db.prepare('SELECT result FROM remote_inbox WHERE id=?').get(stale.route.id)?.result)).data).toMatchObject({ code: 'revision_conflict' })
  expect(store.db.prepare('SELECT count(*) AS count FROM control_runs').get()?.count).toBe(0)
})
