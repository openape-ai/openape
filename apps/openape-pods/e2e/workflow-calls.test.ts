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
import { WorkflowEngine } from '../src/worker/workflows/engine'
import { PodGroups } from '../src/worker/workspace/groups'
import type { GraphContract } from '../src/contracts/graphs'

cleanupAfterEach()

it('network workflow boundary: native correlated calls deduplicate, retain paused results and join only complete invoice cases', async () => {
  const { root } = await seed()
  const identity = await fixtureShellIdentity(root)
  const store = new PodDatabase(root)
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  const helper = resolve('dist/native/pods-helper')
  const resources = new ResourceRegistry(store, () => {})
  const dispatcher = new RunDispatcher(store, resources, { helper, environment: {} } as AgentRuntime)
  const groups = new PodGroups(store)
  groups.execute({ type: 'organize', action: 'create', name: 'Synthetic invoice company', revision: groups.view().revision })
  const groupId = groups.view().groups.at(-1)!.id
  store.db.prepare('INSERT INTO network_owners VALUES(?,?)').run(identity.owner.issuer, identity.owner.subject)
  const workflowId = randomUUID(); const requestIds = [randomUUID(), randomUUID()]
  function member(name: string, contract: GraphContract, body: string): string {
    const pod = store.createPod({ name })
    groups.execute({ type: 'organize', action: 'move', podId: pod.id, groupId, revision: groups.view().revision })
    installExample(store, resources, pod.id, 'deterministic', runtime.dependencyLockHash)
    const previous = JSON.parse(store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(pod.id)!.manifest as string)
    const code = `export const contract=${JSON.stringify(contract)}; export async function run(context) { ${body} return {status:'completed',summary:'Synthetic native invoice settled',completedInputIds:context.input.eventIds,gapIds:[]}; }`
    const hash = digest(code); const definitionId = randomUUID()
    store.storeScript(pod.id, { ...previous, contentHash: hash, contract }, code)
    store.transaction(() => {
      store.db.prepare('UPDATE pods SET active_script=?,lifecycle=\'active\' WHERE id=?').run(hash, pod.id)
      store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(pod.id, hash, pod.bindingRevision, resources.epoch(pod.id), JSON.stringify({ synthetic: true, actualNativeScript: true }))
      store.db.prepare('INSERT INTO pod_definitions VALUES(?,?,?,?,?)').run(definitionId, identity.owner.issuer, identity.owner.subject, name, Date.now())
      store.db.prepare('INSERT INTO pod_definition_versions VALUES(?,1,?,?,?,?)').run(definitionId, hash, previous.dependencyLockHash, JSON.stringify(contract), Date.now())
      store.db.prepare('INSERT INTO instance_definition_bindings VALUES(?,?,1,1)').run(pod.id, definitionId)
    })
    return pod.id
  }
  const source = member('Invoice source', { takes: [], gives: ['input', 'left', 'right'], summary: 'Synthetic invoices' }, `for(const subject of ['INV-1','INV-2'])await context.network.emit({channel:'input',key:subject,sourceItemId:subject,sourceVersion:'1',payload:{subject}}); await context.network.emit({channel:'left',key:'INV-incomplete',sourceItemId:'INV-incomplete',sourceVersion:'1',payload:{subject:'INV-incomplete'}});`)
  const caller = member('Finite workflow caller', { takes: ['input'], gives: ['output', 'terminal'], summary: 'Correlated finite request' }, `for(const item of context.items){const requestId=${JSON.stringify(requestIds)}[item.data.subject==='INV-1'?0:1]; const payload={requestId,workflowId:'${workflowId}',workflowRevision:1,inputs:{invoice:{version:1,data:item.data}},routes:{outputs:{result:'output'},terminal:'terminal'}}; const first=await context.workflow.call(payload); const second=await context.workflow.call(payload); if(first.requestId!==requestId || !second.duplicate)throw new Error('Duplicate call was not retained');}`)
  const finite = member('Finite invoice processor', { takes: [], gives: [], summary: 'Reusable finite workflow member' }, `if(!context.input.workflow.call || !context.input.workflow.inputs.invoice)throw new Error('Missing correlated named input'); await new Promise(resolve=>setTimeout(resolve,2500)); await context.workflow.publish({schema:'invoice/v1',data:context.input.workflow.inputs.invoice.data});`)
  const sink = member('Joined invoice result', { takes: ['output', 'terminal'], gives: [], summary: 'Requires output and terminal receipt' }, `if(context.items.length!==2 || new Set(context.items.map(item=>item.caseId+':'+item.caseRevision)).size!==1)throw new Error('Invoice cases were mixed'); const terminal=context.items.find(item=>item.channel==='terminal'); const output=context.items.find(item=>item.channel==='output'); if(!terminal || !output || terminal.data.status!=='completed')throw new Error('Missing finite terminal result'); await context.progress.commit({expectedRevision:context.input.checkpointRevision,checkpoint:{subject:output.data.subject,requestId:terminal.data.requestId,caseId:output.caseId,caseRevision:output.caseRevision},sources:[],claims:[]});`)
  const incomplete = member('Incomplete invoice review', { takes: ['left', 'right'], gives: [], summary: 'Missing input requires owner review' }, `throw new Error('An incomplete join must never dispatch');`)
  const workflows = new WorkflowEngine(store, dispatcher, { inspect: async () => { throw new Error('Synthetic acceptance does not authorize recovery') } })
  const schema = { type: 'object' as const, properties: { subject: { type: 'string' as const } }, required: ['subject'], additionalProperties: false as const }
  workflows.save({ type: 'save', id: workflowId, revision: 0, name: 'Finite invoice workflow', groupId, nodes: [{ podId: finite, after: [], handoff: false }], schedule: null, enabled: false })
  workflows.pause(workflowId, 1, false)
  workflows.publishRevision(workflowId, 2, { version: 1, inputs: [{ name: 'invoice', version: 1, schema, podId: finite }], outputs: [{ name: 'result', version: 1, schema, podId: finite, legacySchema: 'invoice/v1' }], requiredTerminals: [finite], requiredGates: [] })
  const networks = new NetworkEngine(store, dispatcher, resources, helper, () => identity.owner)
  const id = networks.execute({ type: 'create', draft: { name: 'Synthetic native invoice network', groupId, members: [{ podId: source, source: { schedule: null }, serialCase: false }, ...[caller, sink, incomplete].map(podId => ({ podId, source: null, serialCase: true }))], channels: ['input', 'output', 'terminal', 'left', 'right'].map(name => ({ name, title: name, schemaVersion: 1, schema: name === 'terminal' ? { type: 'object', properties: { requestId: { type: 'string' }, status: { type: 'string', enum: ['completed', 'failed', 'cancelled'] } }, required: ['requestId', 'status'], additionalProperties: false } : schema })), joins: [{ id: 'result', podId: sink, channels: ['output', 'terminal'], deadlineMs: 10000, reviewDestination: 'owner' }, { id: 'incomplete', podId: incomplete, channels: ['left', 'right'], deadlineMs: 1000, reviewDestination: 'owner' }] } }).createdId!
  store.db.prepare('INSERT INTO workflow_call_permissions VALUES(?,?,?,?,?,?,?,1,1)').run(workflowId, 1, id, caller, identity.owner.issuer, identity.owner.subject, groupId)
  store.db.prepare('INSERT INTO remote_registration VALUES(1,?,0)').run(JSON.stringify({ owner: identity.owner }))
  await networks.stop(); await dispatcher.stop(); store.close()
  identity.attachPods()
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
  await expect.poll(() => inspect(database => database.db.prepare('SELECT count(*) AS count FROM workflow_call_requests WHERE state=\'running\'').get()!.count)).toBe(1)
  await page.evaluate(id => window.pods.networks({ type: 'pause', id, revision: 1 }), id)
  try { await expect.poll(() => inspect(database => database.db.prepare('SELECT count(*) AS count FROM workflow_call_requests WHERE state=\'completed\'').get()!.count)).toBe(1) }
  catch (failure) {
    await mkdir(resolve('.artifacts'), { recursive: true })
    const diagnostic = inspect(database => ({ calls: database.db.prepare('SELECT id,state,workflow_run_id FROM workflow_call_requests').all(), controls: database.db.prepare('SELECT request_id,diagnostic,delivery_state FROM workflow_call_controls').all(), workflows: database.db.prepare('SELECT id,state,paused,reason,finished_at FROM workflow_runs').all(), nodes: database.db.prepare('SELECT pod_id,state,run_id,reason,output FROM workflow_nodes').all(), runs: database.db.prepare('SELECT id,pod_id,state,summary,error FROM runs').all() }))
    await writeFile(resolve('.artifacts/workflow-calls-native-failure.json'), JSON.stringify(diagnostic, null, 2))
    throw failure
  }
  expect(inspect(database => database.db.prepare('SELECT count(*) AS count FROM workflow_call_result_events').get()!.count)).toBe(0)
  const retainedWhilePaused = inspect(database => database.db.prepare('SELECT id,case_id,result FROM workflow_call_requests WHERE state=\'completed\'').get())!
  expect(JSON.parse(retainedWhilePaused.result as string).status).toBe('completed')
  await page.evaluate(id => window.pods.networks({ type: 'activate', id, revision: 1 }), id)
  await expect.poll(() => inspect(database => database.db.prepare('SELECT count(*) AS count FROM workflow_call_result_events').get()!.count)).toBe(4)
  await expect.poll(() => inspect(database => database.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(sink)!.revision)).toBe(2)
  await expect.poll(() => inspect(database => database.db.prepare('SELECT state FROM network_joins WHERE join_id=\'incomplete\'').get()!.state)).toBe('blocked')
  const evidence = inspect((database) => {
    const calls = database.db.prepare('SELECT id,case_id,case_revision,workflow_run_id,state,result FROM workflow_call_requests ORDER BY rowid').all()
    const joins = database.db.prepare('SELECT join_id,case_id,case_revision,state,reason FROM network_joins ORDER BY rowid').all()
    expect(calls).toHaveLength(2)
    expect(new Set(calls.map(call => call.case_id)).size).toBe(2)
    expect(new Set(calls.map(call => call.workflow_run_id)).size).toBe(2)
    expect(calls.every(call => call.state === 'completed')).toBe(true)
    expect(joins.filter(join => join.join_id === 'result').every(join => join.state === 'completed')).toBe(true)
    expect(database.db.prepare('SELECT count(*) AS count FROM workflow_runs').get()!.count).toBe(2)
    expect(database.db.prepare('SELECT count(*) AS count FROM network_events WHERE channel=\'terminal\'').get()!.count).toBe(2)
    expect(database.db.prepare('SELECT count(*) AS count FROM network_invocations WHERE pod_id=?').get(incomplete)!.count).toBe(0)
    return { route: 'Actual Electron preload/main/worker/native ScriptFrame', calls, joins, retainedWhilePaused, finiteExecutions: 2, terminalResults: 2, joinedInvoiceCheckpointRevision: 2, incompleteInvocations: 0 }
  })
  await page.getByRole('button', { name: 'Synthetic native invoice network', exact: false }).click()
  await page.getByText('Joined invoice result', { exact: true }).waitFor()
  await page.getByText('Signed in', { exact: true }).waitFor()
  await mkdir(resolve('.artifacts'), { recursive: true })
  await page.screenshot({ path: resolve('.artifacts/workflow-calls-native.png'), fullPage: true })
  await writeFile(resolve('.artifacts/workflow-calls-native.json'), JSON.stringify(evidence, null, 2))
  await app.close()
})
