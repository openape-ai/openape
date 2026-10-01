import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { cleanupAfterEach, launch, seed } from './fixtures/crash'
import { fixtureShellIdentity } from './fixtures/shell-identity'
import { PodDatabase, digest } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { RunDispatcher } from '../src/worker/runs/dispatcher'
import type { AgentRuntime } from '../src/worker/agent/executor'
import { NetworkEngine } from '../src/worker/scheduling/network-engine'
import { PodGroups } from '../src/worker/workspace/groups'
import type { GraphContract } from '../src/contracts/graphs'

cleanupAfterEach()
async function pendingNetworkGate() {
  const { root } = await seed()
  const store = new PodDatabase(root)
  const temporaryOwner = { issuer: 'https://identity.example.invalid', subject: 'fixture-owner@example.test' }
  const resources = new ResourceRegistry(store, () => {})
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  const helper = resolve('dist/native/pods-helper')
  const dispatcher = new RunDispatcher(store, resources, { helper, environment: {} } as AgentRuntime)
  const groups = new PodGroups(store)
  groups.execute({ type: 'organize', action: 'create', name: 'Synthetic gate company', revision: groups.view().revision })
  const groupId = groups.view().groups.at(-1)!.id
  store.db.prepare('INSERT INTO network_owners VALUES(?,?)').run(temporaryOwner.issuer, temporaryOwner.subject)
  function member(name: string, contract: GraphContract, body: string): string {
    const pod = store.createPod({ name })
    groups.execute({ type: 'organize', action: 'move', podId: pod.id, groupId, revision: groups.view().revision })
    installExample(store, resources, pod.id, 'deterministic', runtime.dependencyLockHash)
    const previous = JSON.parse(store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(pod.id)!.manifest as string)
    const code = `export const contract=${JSON.stringify(contract)}; export async function run(context) { ${body} return {status:'completed',summary:'Synthetic native gate settled',completedInputIds:context.input.eventIds,gapIds:[]}; }`
    const hash = digest(code); const definitionId = randomUUID()
    store.storeScript(pod.id, { ...previous, contentHash: hash, contract }, code)
    store.transaction(() => {
      store.db.prepare('UPDATE pods SET active_script=?,lifecycle=\'active\' WHERE id=?').run(hash, pod.id)
      store.db.prepare('INSERT INTO validations VALUES(?,?,?,?,?)').run(pod.id, hash, store.getPod(pod.id).bindingRevision, 0, '{"synthetic":true,"nativeGate":true}')
      store.db.prepare('INSERT INTO pod_definitions VALUES(?,?,?,?,?)').run(definitionId, temporaryOwner.issuer, temporaryOwner.subject, name, Date.now())
      store.db.prepare('INSERT INTO pod_definition_versions VALUES(?,1,?,?,?,?)').run(definitionId, hash, runtime.dependencyLockHash, JSON.stringify(contract), Date.now())
      store.db.prepare('INSERT INTO instance_definition_bindings VALUES(?,?,1,1)').run(pod.id, definitionId)
    })
    return pod.id
  }
  const source = member('Gate source', { takes: [], gives: ['test.input'], summary: 'Source' }, `await context.network.emit({channel:'test.input',key:'record',sourceItemId:'record',sourceVersion:'v1',payload:{subject:'Synthetic once-approved input'}});`)
  const consumer = member('Gate consumer', { takes: ['test.input'], gives: [], summary: 'Gated consumer' }, `const approvals=await context.network.gateCoverage(); if(approvals.length!==1 || approvals[0].items.length!==1)throw new Error('Missing exact consumed grant coverage'); await context.progress.commit({expectedRevision:context.input.checkpointRevision,checkpoint:{approved:true},sources:[],claims:[]});`)
  const independent = member('Independent consumer', { takes: ['test.input'], gives: [], summary: 'Independent consumer' }, `await context.progress.commit({expectedRevision:context.input.checkpointRevision,checkpoint:{independent:true},sources:[],claims:[]});`)
  const engine = new NetworkEngine(store, dispatcher, resources, helper, () => temporaryOwner)
  const id = engine.execute({ type: 'create', draft: { name: 'Synthetic native gate network', groupId, members: [{ podId: source, source: { schedule: null }, serialCase: false }, ...[consumer, independent].map(podId => ({ podId, source: null, serialCase: true }))], channels: [{ name: 'test.input', title: 'Input', schemaVersion: 1, schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false } }], gates: [{ key: 'review', title: 'Review exact consumer input', kind: 'approve', podId: consumer, channel: 'test.input' }] } }).createdId!
  await engine.stop(); await dispatcher.stop(); store.close()
  const identity = await fixtureShellIdentity(root, [], true)
  const bind = new PodDatabase(root)
  try {
    bind.transaction(() => {
      bind.db.prepare('INSERT INTO network_owners VALUES(?,?)').run(identity.owner.issuer, identity.owner.subject)
      bind.db.prepare('UPDATE pod_definitions SET owner_issuer=? WHERE owner_issuer=?').run(identity.owner.issuer, temporaryOwner.issuer)
      bind.db.prepare('UPDATE networks SET owner_issuer=? WHERE id=?').run(identity.owner.issuer, id)
      bind.db.prepare('INSERT INTO remote_registration VALUES(1,?,0)').run(JSON.stringify({ owner: identity.owner }))
    })
  }
  finally { bind.close() }
  const inspect = <T>(read: (database: PodDatabase) => T): T => {
    const database = new PodDatabase(root)
    try { return read(database) }
    finally { database.close() }
  }
  const { app, page } = await launch(root, false, identity)
  await expect.poll(async () => {
    try { return (await page.evaluate(id => window.pods.networks({ type: 'activate', id, revision: 1 }), id)).networks[0]!.state }
    catch (failure) { if (!(failure instanceof Error) || !failure.message.includes('ready local runtime')) throw failure; return 'starting' }
  }).toBe('active')
  const preview = await page.evaluate(({ id, source }) => window.pods.networks({ type: 'preview', id, revision: 1, podIds: [source], pausedPodIds: [], budget: 1 }), { id, source })
  await page.evaluate(({ id, previewId }) => window.pods.networks({ type: 'process', id, revision: 1, previewId }), { id, previewId: preview.preview!.id })
  await expect.poll(() => identity.gates().length).toBe(1)
  await expect.poll(() => inspect(database => database.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(independent)!.revision)).toBe(1)
  expect(inspect(database => database.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(consumer)!.revision)).toBe(0)
  expect(inspect(database => database.db.prepare('SELECT count(*) AS count FROM network_invocations WHERE pod_id=? AND execution_kind=\'script\'').get(consumer)!.count)).toBe(0)
  return { root, id, consumer, independent, identity, inspect, app, page }
}

it('network gate boundary: uses the actual Electron main/worker route and signed manually decided once-grant before script launch', async () => {
  const { id, consumer, identity, inspect, app, page } = await pendingNetworkGate()
  const pending = (await page.evaluate(() => window.pods.networks({ type: 'list' }))).gates![0]!
  expect(pending).toMatchObject({ state: 'pending', podId: consumer, networkId: id })
  await expect(page.evaluate(({ id, taskId, generation }) => window.pods.networks({ type: 'gateExclude', id, revision: 1, taskId, generation, deliveryIds: [crypto.randomUUID()], evidence: 'Forged foreign input' }), { id, taskId: pending.id, generation: pending.generation })).rejects.toThrow('foreign network gate input')
  const grant = identity.gates()[0]!
  const command = JSON.parse(grant.command[2]!)
  expect(command).toMatchObject({ version: 3, podId: consumer, networkId: id, count: 1 })
  expect(command.dataPin).toMatch(/^[a-f0-9]{64}$/)
  expect(grant.consumeAttempts).toBe(0)
  identity.decideGate(grant.id, 'approved')
  await expect.poll(() => inspect(database => database.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(consumer)!.revision), { timeout: 20000 }).toBe(1).catch(async (failure: unknown) => {
    await mkdir('.artifacts', { recursive: true })
    await writeFile('.artifacts/network-gates-native-failure.json', JSON.stringify({ synthetic: true, grants: identity.gates(), view: await page.evaluate(() => window.pods.networks({ type: 'list' })), rows: inspect(database => Object.fromEntries(['network_gate_tasks', 'network_gate_task_attempts', 'network_gate_controls', 'network_invocations', 'network_invocation_controls', 'network_trace_events'].map(table => [table, database.db.prepare(`SELECT * FROM ${table}`).all()]))) }, null, 2))
    throw failure
  })
  expect(identity.gates()[0]).toMatchObject({ status: 'used', consumeAttempts: 1 })
  expect(inspect(database => database.db.prepare('SELECT count(*) AS count FROM network_invocations WHERE pod_id=? AND execution_kind=\'script\'').get(consumer)!.count)).toBe(1)
  expect((await page.evaluate(() => window.pods.networks({ type: 'list' }))).gates![0]!.state).toBe('approved')
  await mkdir('.artifacts', { recursive: true })
  await page.screenshot({ path: '.artifacts/network-gates-native.png', fullPage: true })
  await app.close()
  expect(identity.gates()[0]!.consumeAttempts).toBe(1)
})

it('network gate boundary: retains unknown consumption after a real signed once-grant and worker SIGKILL without consuming again', async () => {
  const { root, id, consumer, identity, inspect, app, page } = await pendingNetworkGate()
  const grant = identity.gates()[0]!
  identity.holdGateConsume(grant.id)
  identity.decideGate(grant.id, 'approved')
  await expect.poll(() => identity.gates()[0]!.status, { timeout: 20000 }).toBe('used')
  expect(identity.gates()[0]!.consumeAttempts).toBe(1)
  expect(inspect(database => database.db.prepare('SELECT state FROM network_gate_tasks').get()!.state)).toBe('consuming')
  const attemptsBeforeCrash = inspect(database => database.db.prepare('SELECT count(*) AS count FROM network_gate_task_attempts').get()!.count)
  const worker = (await page.evaluate(() => window.pods.getStatus())).worker.pid!
  process.kill(worker, 'SIGKILL')
  await page.getByRole('alert').filter({ hasText: 'Quit and reopen Pods' }).waitFor()
  await app.close()
  await expect.poll(() => {
    try { process.kill(worker, 0); return 'alive' }
    catch (failure) { if ((failure as NodeJS.ErrnoException).code === 'ESRCH') return 'gone'; throw failure }
  }).toBe('gone')
  identity.releaseGateConsume(grant.id)
  const { app: reopenedApp, page: reopened } = await launch(root, false)
  await expect.poll(() => inspect(database => database.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count)).toBe(0)
  const view = await reopened.evaluate(() => window.pods.networks({ type: 'list' }))
  const unknown = view.gates![0]!
  expect(unknown).toMatchObject({ state: 'unknown', podId: consumer, networkId: id })
  expect(inspect(database => database.db.prepare('SELECT count(*) AS count FROM network_gate_task_attempts').get()!.count)).toBe(attemptsBeforeCrash)
  expect(inspect(database => database.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(consumer)!.revision)).toBe(0)
  expect(inspect(database => database.db.prepare('SELECT count(*) AS count FROM network_invocations WHERE pod_id=? AND execution_kind=\'script\'').get(consumer)!.count)).toBe(0)
  await reopened.evaluate(({ id, taskId, generation }) => window.pods.networks({ type: 'gateDiscard', id, revision: 1, taskId, generation, evidence: 'Synthetic owner discards exact uncertain inputs after verified worker cleanup; prior once consume stays unknown' }), { id, taskId: unknown.id, generation: unknown.generation })
  expect(inspect(database => database.db.prepare('SELECT state FROM network_deliveries WHERE id=?').get(unknown.items[0]!.deliveryId)!.state)).toBe('discarded')
  expect(inspect(database => database.db.prepare('SELECT state FROM network_gate_task_attempts WHERE task_id=? ORDER BY attempt DESC LIMIT 1').get(unknown.id)!.state)).toBe('unknown')
  await mkdir('.artifacts', { recursive: true })
  await reopened.getByText('Gate consumer', { exact: true }).waitFor()
  await reopened.getByText('Signed in', { exact: true }).waitFor()
  await reopened.screenshot({ path: '.artifacts/network-gates-crash-native.png', fullPage: true })
  await reopenedApp.close()
  expect(identity.gates()[0]).toMatchObject({ status: 'used', consumeAttempts: 1 })
})
