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

it('network data boundary: actual native scripts share revisioned records and scoped artifacts, while an unauthorized consumer fails closed', async () => {
  const { root } = await seed()
  const identity = await fixtureShellIdentity(root)
  const store = new PodDatabase(root)
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  const helper = resolve('dist/native/pods-helper')
  const resources = new ResourceRegistry(store, () => {})
  const dispatcher = new RunDispatcher(store, resources, { helper, environment: {} } as AgentRuntime)
  const groups = new PodGroups(store)
  groups.execute({ type: 'organize', action: 'create', name: 'Synthetic shared-data company', revision: groups.view().revision })
  const groupId = groups.view().groups.at(-1)!.id
  store.db.prepare('INSERT INTO network_owners VALUES(?,?)').run(identity.owner.issuer, identity.owner.subject)
  const collectionId = randomUUID(); const scopeId = randomUUID()
  function member(name: string, contract: GraphContract, body: string): string {
    const pod = store.createPod({ name })
    groups.execute({ type: 'organize', action: 'move', podId: pod.id, groupId, revision: groups.view().revision })
    installExample(store, resources, pod.id, 'deterministic', runtime.dependencyLockHash)
    const previous = JSON.parse(store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(pod.id)!.manifest as string)
    const code = `export const contract=${JSON.stringify(contract)}; export async function run(context) { ${body} return {status:'completed',summary:'Synthetic native data settled',completedInputIds:context.input.eventIds,gapIds:[]}; }`
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
  const source = member('Data source', { takes: [], gives: ['test.data'], summary: 'Source' }, `const artifact=await context.artifacts.create({scope:'${scopeId}',bytesBase64:'U3ludGhldGljIG5hdGl2ZSBldmlkZW5jZQ==',mediaType:'text/plain'}); const reference={id:artifact.id,scope:artifact.scope}; await context.data.put({collection:'cases',key:'one',expectedRevision:0,value:{status:'new',artifact:artifact.id},artifacts:[reference]}); await context.network.emit({channel:'test.data',key:'one',sourceItemId:'one',sourceVersion:'v1',payload:{subject:'Synthetic case',artifact:artifact.id},artifacts:[reference]});`)
  const consumer = member('Authorized data consumer', { takes: ['test.data'], gives: [], summary: 'Updates the case' }, `const current=await context.data.get({collection:'cases',key:'one'}); if(current.revision!==1 || current.provenance.verification!=='proposed')throw new Error('Missing shared revision'); const bytes=await context.artifacts.read(current.artifacts[0]); if(bytes.bytesBase64!=='U3ludGhldGljIG5hdGl2ZSBldmlkZW5jZQ==')throw new Error('Artifact differs'); const indexed=await context.data.query({collection:'cases',index:'status',operator:'eq',value:'new',limit:10}); if(indexed.records.length!==1)throw new Error('Missing declared index'); await context.data.put({collection:'cases',key:'one',expectedRevision:1,value:{status:'reviewed',artifact:current.value.artifact},artifacts:current.artifacts}); await context.progress.commit({expectedRevision:context.input.checkpointRevision,checkpoint:{sharedRevision:2,artifactRead:true},sources:[],claims:[]});`)
  const unauthorized = member('Unauthorized data consumer', { takes: ['test.data'], gives: [], summary: 'No collection binding' }, `await context.data.get({collection:'cases',key:'one'}); throw new Error('Unauthorized shared data unexpectedly readable');`)
  const engine = new NetworkEngine(store, dispatcher, resources, helper, () => identity.owner)
  const id = engine.execute({ type: 'create', draft: { name: 'Synthetic native shared-data network', groupId, members: [{ podId: source, source: { schedule: null }, serialCase: false }, ...[consumer, unauthorized].map(podId => ({ podId, source: null, serialCase: true }))], channels: [{ name: 'test.data', title: 'Shared case', schemaVersion: 1, schema: { type: 'object', properties: { subject: { type: 'string' }, artifact: { type: 'string' } }, required: ['subject', 'artifact'], additionalProperties: false } }] } }).createdId!
  store.transaction(() => {
    store.db.prepare('INSERT INTO data_collections VALUES(?,?,?,?,?,1,?)').run(collectionId, identity.owner.issuer, identity.owner.subject, groupId, 'cases', '{}')
    store.db.prepare('INSERT INTO data_collection_versions VALUES(?,1,?,?,?)').run(collectionId, JSON.stringify({ type: 'object', properties: { status: { type: 'string' }, artifact: { type: 'string' } }, required: ['status', 'artifact'], additionalProperties: false }), JSON.stringify([{ name: 'status', field: 'status' }]), Date.now())
    store.db.prepare('INSERT INTO artifact_scopes VALUES(?,?,?,?,?,NULL)').run(scopeId, identity.owner.issuer, identity.owner.subject, groupId, collectionId)
    for (const podId of [source, consumer]) {
      for (const operation of ['read', 'write']) store.db.prepare('INSERT INTO data_permissions VALUES(?,?,?,?,?,?,?,1)').run(id, podId, collectionId, identity.owner.issuer, identity.owner.subject, groupId, operation)
      for (const operation of ['read', ...(podId === source ? ['create'] : [])]) store.db.prepare('INSERT INTO artifact_permissions VALUES(?,?,?,?,?,?,?,1)').run(id, podId, scopeId, identity.owner.issuer, identity.owner.subject, groupId, operation)
    }
    store.db.prepare('INSERT INTO remote_registration VALUES(1,?,0)').run(JSON.stringify({ owner: identity.owner }))
  })
  await engine.stop(); await dispatcher.stop(); store.close()
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
  await expect.poll(() => inspect(database => database.db.prepare('SELECT revision FROM data_records WHERE collection_id=? AND record_key=\'one\'').get(collectionId)?.revision)).toBe(2)
  await expect.poll(() => inspect(database => database.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(consumer)!.revision)).toBe(1)
  await expect.poll(() => inspect(database => database.db.prepare('SELECT state FROM network_invocations WHERE pod_id=? ORDER BY rowid DESC LIMIT 1').get(unauthorized)?.state)).toBe('blocked')
  expect(inspect(database => database.db.prepare('SELECT body FROM network_checkpoints WHERE pod_id=?').get(consumer)!.body)).toBe('{"artifactRead":true,"sharedRevision":2}')
  expect(inspect(database => database.db.prepare('SELECT count(*) AS count FROM data_record_provenance').get()!.count)).toBe(2)
  expect(inspect(database => database.db.prepare('SELECT count(*) AS count FROM artifacts').get()!.count)).toBe(1)
  expect(inspect(database => database.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(unauthorized)!.revision)).toBe(0)
  const deniedDiagnostic = inspect(database => JSON.parse(database.db.prepare('SELECT c.settlement_receipt FROM network_invocation_controls c JOIN network_invocations i ON i.run_id=c.run_id WHERE i.pod_id=? ORDER BY i.rowid DESC LIMIT 1').get(unauthorized)!.settlement_receipt as string).error)
  expect(deniedDiagnostic).toContain('Collection operation requires an explicit same-company binding')
  await page.getByText('Authorized data consumer', { exact: true }).waitFor()
  await page.getByText('Signed in', { exact: true }).waitFor()
  await mkdir(resolve('.artifacts'), { recursive: true })
  await page.screenshot({ path: resolve('.artifacts/network-data-native.png'), fullPage: true })
  await writeFile(resolve('.artifacts/network-data-native.json'), JSON.stringify({ route: 'Actual Electron preload/main/worker/native ScriptFrame', dataRevision: inspect(database => database.db.prepare('SELECT revision FROM data_records WHERE collection_id=? AND record_key=\'one\'').get(collectionId)!.revision), proposedProvenanceRows: inspect(database => database.db.prepare('SELECT count(*) AS count FROM data_record_provenance').get()!.count), artifactCount: inspect(database => database.db.prepare('SELECT count(*) AS count FROM artifacts').get()!.count), unauthorizedCheckpointRevision: inspect(database => database.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(unauthorized)!.revision), deniedDiagnostic }, null, 2))
  await app.close()
})
