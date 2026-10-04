import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalPortableJson } from '@openape/pods-protocol'
import { afterEach, expect, it, vi  } from 'vitest'
import { createBackup, restoreBackup } from '../../src/worker/data/backup'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { DataRetention } from '../../src/worker/data/retention'
import { validateDraft } from '../../src/worker/master/validation'
import { installExample } from '../../src/worker/runs/examples'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { PodVariables } from '../../src/worker/resources/variables'
import { runAliases } from '../../src/contracts/runs'
import { parsePortableImportCommand } from '../../src/contracts/sharing'
import { PortableImporter, recoverPortableImports } from '../../src/worker/sharing/import'
import type { ImportEngines } from '../../src/worker/sharing/import'
import { NetworkEngine } from '../../src/worker/scheduling/network-engine'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { DefinitionCatalog } from '../../src/worker/workspace/definition-catalog'
import { digest, PodDatabase, schemaVersion  } from '../../src/worker/storage/database'
import { createPortablePackage } from '../../src/worker/sharing/package'
import type { PortableDescription, PortablePayload } from '../../src/worker/sharing/package'
import { RunStore } from '../../src/worker/runs/store'
import { WorkflowEngine } from '../../src/worker/workflows/engine'
import { publishWorkflowOutput, workflowInput } from '../../src/worker/workflows/handoff'
import { PodGroups } from '../../src/worker/workspace/groups'
import { aliasTables, sharingTables } from '../../src/worker/storage/sharing-schema'
import { WorkspaceDetails } from '../../src/worker/workspace/details'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
const bytes = (value: string) => new TextEncoder().encode(value)
const owner = { issuer: 'https://id.example.test', subject: 'recipient' }
const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'pods-sharing-import-')); roots.push(root)
  const store = new PodDatabase(join(root, 'profile')); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  return { root, store, resources, importer: new PortableImporter(store, resources, owner, '') }
}

async function packageFixture(access = false) {
  const description: PortableDescription = {
    format: 'openape-package', version: 1, package: { key: 'fixture', revision: 1, title: 'Portable fixture', description: '' }, requiredFeatures: ['portable_aliases_v1'],
    entry: { kind: 'pod', key: 'fixture' }, compositions: [],
    applications: access ? [{ key: 'fixture_cli', application: 'tool-cli', adapter: { identity: 'tool-cli-adapter', version: 1, operations: ['invoke'] }, testedVersions: [], platforms: [{ os: 'darwin', architecture: 'arm64' }], distribution: null, instructions: '' }] : [],
    pods: [{
      key: 'fixture', title: 'Imported fixture', description: '', script: 'pods/fixture/run.mjs', packages: null, contract: null,
      requestedCapabilities: access ? ['credential.token', 'tool.api.request', 'tool.cli.invoke'] : [],
      access: access ? [{ kind: 'http', alias: 'api', origin: 'input_4', methods: ['GET'], authentication: null }, { kind: 'directory', alias: 'inbox', input: 'input_7', access: 'read' }, { kind: 'directory', alias: 'archive', input: 'input_10', access: 'read' }] : [],
      inputs: [
        { key: 'input_1', label: 'greeting', description: '', kind: 'string', required: true, sharingGroup: null, default: 'hello' },
        { key: 'input_2', label: 'limit', description: '', kind: 'number', required: true, sharingGroup: null, minimum: 1, maximum: 10 },
        ...(access ? [{ key: 'input_3', label: 'token', description: '', kind: 'secret' as const, required: true, sharingGroup: null }, { key: 'input_4', label: 'api origin', description: '', kind: 'string' as const, required: true, sharingGroup: null, default: 'https://api.example.test' }, { key: 'input_5', label: 'first', description: '', kind: 'string' as const, required: true, sharingGroup: 'region' }, { key: 'input_6', label: 'second', description: '', kind: 'string' as const, required: true, sharingGroup: 'region' }, { key: 'input_7', label: 'inbox', description: '', kind: 'directory' as const, required: true, sharingGroup: null }, { key: 'input_8', label: 'cli account', description: '', kind: 'account' as const, required: true, sharingGroup: null }, { key: 'input_9', label: 'REGION', description: '', kind: 'string' as const, required: true, sharingGroup: null, default: 'eu' }, { key: 'input_10', label: 'archive', description: '', kind: 'directory' as const, required: true, sharingGroup: null }] : []),
      ],
      bindings: [{ alias: 'greeting', input: 'input_1' }, { alias: 'limit', input: 'input_2' }, ...(access ? [{ alias: 'token', input: 'input_3' }, { alias: 'first', input: 'input_5' }, { alias: 'second', input: 'input_6' }] : [])],
      applications: access ? [{ alias: 'cli', requirement: 'fixture_cli', account: 'input_8', environment: [{ alias: 'REGION', input: 'input_9' }] }] : [], assets: ['assets/template.txt'], schedule: { kind: 'interval', seconds: 3600 },
    }],
  }
  const payloads: PortablePayload[] = [{ path: 'pods/fixture/run.mjs', kind: 'script', mediaType: 'text/javascript', content: bytes('export async function run() { return { status: "completed" } }') }, { path: 'assets/template.txt', kind: 'asset', mediaType: 'text/plain', content: bytes('Reusable template') }]
  return createPortablePackage(description, payloads, '')
}
const podRows = (store: PodDatabase, podId: string) => JSON.stringify([store.getPod(podId), ...['script_drafts', 'pod_variables', 'resources', 'checkpoints'].map(table => store.db.prepare(`SELECT * FROM ${table} WHERE pod_id=? ORDER BY rowid`).all(podId))])
function deletePod(store: PodDatabase, podId: string) { for (const table of ['resources', 'resource_epochs', 'script_drafts', 'checkpoints']) store.db.prepare(`DELETE FROM ${table} WHERE pod_id=?`).run(podId); store.db.prepare('DELETE FROM pods WHERE id=?').run(podId) }

it('stages one journal per request key without creating Pods', async () => {
  const { store, resources, importer } = workspace(); const exported = await packageFixture(); const id = randomUUID()
  expect((await importer.inspect(exported.archive)).transferSha256).toBe(exported.transferSha256)
  expect(store.db.prepare('SELECT count(*) AS count FROM portable_imports').get()!.count).toBe(0)
  const staged = await importer.stage(id, exported.archive)
  expect(staged).toMatchObject({ state: 'staged', revision: 1, transferSha256: exported.transferSha256, unresolved: [{ scope: 'pod', key: 'fixture', requirement: 'value', name: 'input_2' }] })
  expect(await importer.stage(id, exported.archive)).toEqual(staged)
  expect(() => parsePortableImportCommand({ type: 'stage', id, archive: exported.archive, extra: true })).toThrow('Invalid import command')
  expect(() => parsePortableImportCommand({ type: 'configure', id, revision: 1, values: { pods: { fixture: { input_1: {} } }, compositions: {} } })).toThrow('Invalid import command')
  expect(parsePortableImportCommand({ type: 'bind', id, revision: 1, pod: 'fixture', alias: 'api', resourceId: id, bundle: null }).type).toBe('bind')
  await expect(importer.stage(id, (await packageFixture(true)).archive)).rejects.toThrow('reused with a different package')
  await expect(new PortableImporter(store, resources, { ...owner, subject: 'someone-else' }, '').stage(id, exported.archive)).rejects.toThrow('another owner')
  expect(() => new PortableImporter(store, resources, { ...owner, subject: 'someone-else' }, '').view(id)).toThrow('another owner')
  expect(store.listPods()).toEqual([])
  expect(store.db.prepare('SELECT count(*) AS count FROM portable_imports').get()!.count).toBe(1)
  expect((await importer.stage(randomUUID(), exported.archive)).pods[0]!.podId).not.toBe(staged.pods[0]!.podId)
  await expect(importer.stage(randomUUID(), exported.archive.subarray(0, -1))).rejects.toThrow('complete single-volume')
})

it('accepts only declared scalar values at the current revision', async () => {
  const { importer } = workspace(); const id = randomUUID(); const staged = await importer.stage(id, (await packageFixture(true)).archive)
  const set = (revision: number, input: string, value: string | number | boolean | null) => importer.configure(id, revision, { pods: { fixture: { [input]: value } }, compositions: {} })
  expect(() => set(1, 'input_2', 11)).toThrow('does not match')
  expect(() => set(1, 'input_2', '5')).toThrow('does not match')
  expect(() => set(1, 'input_3', 'secret-value')).toThrow('bound through setup')
  expect(() => set(1, 'missing', 1)).toThrow('undeclared input')
  expect(() => importer.configure(id, 1, { pods: { other: { input_1: 'x' } }, compositions: {} })).toThrow('undeclared package member')
  const configured = set(1, 'input_2', 5)
  expect(configured).toMatchObject({ revision: 2, values: { pods: { fixture: { input_2: 5 } } }, unresolved: [{ requirement: 'value', name: 'input_5' }, { requirement: 'value', name: 'input_6' }, { requirement: 'secret', name: 'token' }, { requirement: 'access', name: 'api' }, { requirement: 'access', name: 'inbox' }, { requirement: 'access', name: 'archive' }, { requirement: 'application', name: 'cli' }] })
  expect(() => set(1, 'input_2', 6)).toThrow('Import changed')
  expect(() => set(2, 'input_5', '\uD800')).toThrow('does not match')
  expect(set(2, 'input_5', 'eu')).toMatchObject({ values: { pods: { fixture: { input_5: 'eu', input_6: 'eu' } } }, unresolved: [{ scope: 'pod', key: 'fixture', requirement: 'secret', name: 'token' }, { requirement: 'access', name: 'api' }, { requirement: 'access', name: 'inbox' }, { requirement: 'access', name: 'archive' }, { requirement: 'application', name: 'cli' }] })
  expect(set(3, 'input_2', null).unresolved).toHaveLength(6)
  expect(JSON.stringify(staged)).not.toContain('secret-value')
})

it('creates one independent paused copy and returns it for a repeated commit', async () => {
  const { store, importer } = workspace(); const existing = store.createPod({ name: 'Existing' }); new PodVariables(store).save(existing.id, 'greeting', 'mine', 0)
  const before = podRows(store, existing.id); const id = randomUUID(); await importer.stage(id, (await packageFixture()).archive)
  importer.configure(id, 1, { pods: { fixture: { input_2: 5 } }, compositions: {} })
  const committed = await importer.commit(id, 2); const podId = committed.pods[0]!.podId
  expect(committed).toMatchObject({ state: 'committed', unresolved: [] })
  expect(store.getPod(podId)).toMatchObject({ name: 'Imported fixture', lifecycle: 'paused', activeScript: null })
  expect(new PodVariables(store).values(podId)).toEqual({ greeting: 'hello', limit: '5' })
  expect(store.db.prepare('SELECT code,capabilities,validation,script_hash FROM script_drafts WHERE pod_id=?').get(podId)).toMatchObject({ capabilities: '[]', validation: null, script_hash: null })
  for (const table of ['scripts', 'validations', 'schedules', 'remote_pods', 'script_credential_approvals']) expect(store.db.prepare(`SELECT count(*) AS count FROM ${table} WHERE pod_id=?`).get(podId)!.count, table).toBe(0)
  const reference = store.db.prepare('SELECT name,configuration FROM resources WHERE pod_id=? AND kind=\'reference\'').get(podId)!
  expect(reference.name).toBe('assets/template.txt')
  expect(readFileSync(JSON.parse(String(reference.configuration)).path, 'utf8')).toBe('Reusable template')
  expect(await importer.commit(id, 2)).toEqual(committed)
  expect(store.listPods()).toHaveLength(2)
  expect(podRows(store, existing.id)).toBe(before)
})

it('keeps unfinished setup from activating and finishes only resolved imports', async () => {
  const { store, resources, importer } = workspace(); const id = randomUUID(); await importer.stage(id, (await packageFixture(true)).archive)
  importer.configure(id, 1, { pods: { fixture: { input_2: 5, input_6: 'eu' } }, compositions: {} })
  const committed = await importer.commit(id, 2); const podId = committed.pods[0]!.podId
  expect(new PodVariables(store).values(podId)).toEqual({ greeting: 'hello', limit: '5', first: 'eu', second: 'eu' })
  expect(() => new WorkspaceDetails(store, resources).execute({ type: 'activate', podId, hash: 'a'.repeat(64), assignmentRevision: 1, expectedActive: null })).toThrow('Finish the import setup')
  expect(store.db.prepare('SELECT capabilities FROM script_drafts WHERE pod_id=?').get(podId)!.capabilities).toBe('["credential.token"]')
  const draft = store.db.prepare('SELECT id FROM script_drafts WHERE pod_id=?').get(podId)!.id as string
  await expect(validateDraft(store, resources, {} as AgentRuntime, draft, 1, new AbortController().signal)).rejects.toThrow('Finish the import setup')
  expect(() => installExample(store, resources, podId, 'deterministic', 'a'.repeat(64))).toThrow('Finish the import setup')
  expect(() => importer.complete(id, committed.revision)).toThrow('setup is incomplete')
  const plain = randomUUID(); await importer.stage(plain, (await packageFixture()).archive); importer.configure(plain, 1, { pods: { fixture: { input_2: 2 } }, compositions: {} })
  const ready = await importer.commit(plain, 2); const completed = importer.complete(plain, ready.revision)
  expect(completed.state).toBe('completed')
  expect(importer.complete(plain, ready.revision)).toEqual(completed)
  expect(store.db.prepare('SELECT archive_hash FROM portable_imports WHERE id=?').get(plain)!.archive_hash).toBeNull()
  expect(() => new WorkspaceDetails(store, resources).execute({ type: 'activate', podId: ready.pods[0]!.podId, hash: 'a'.repeat(64), assignmentRevision: 1, expectedActive: null })).toThrow('Script version not found')
  expect(importer.cancel(plain, completed.revision).state).toBe('completed')
})

it('binds declared aliases to matching local assignments and exposes them to scripts', async () => {
  const { root, store, resources, importer } = workspace(); const id = randomUUID(); await importer.stage(id, (await packageFixture(true)).archive)
  importer.configure(id, 1, { pods: { fixture: { input_5: 'eu' } }, compositions: {} })
  let view = await importer.commit(id, 2); const podId = view.pods[0]!.podId
  const open = () => importer.view(id).unresolved.map(item => `${item.requirement}:${item.name}`)
  expect(open()).toEqual(['value:input_2', 'secret:token', 'access:api', 'access:inbox', 'access:archive', 'application:cli'])
  new PodVariables(store).save(podId, 'limit', '99', 0)
  expect(open()).toEqual(['value:input_2', 'secret:token', 'access:api', 'access:inbox', 'access:archive', 'application:cli'])
  new PodVariables(store).save(podId, 'limit', '5', 1)
  expect(open()).toEqual(['secret:token', 'access:api', 'access:inbox', 'access:archive', 'application:cli'])
  const assign = (name: string, configuration: Record<string, unknown>) => {
    const resource = randomUUID(); const capability = `tool.${configuration.type === 'http' ? 'http' : 'app'}_${resource.replaceAll('-', '')}.${configuration.type === 'http' ? 'request' : 'invoke'}`
    store.db.prepare('INSERT INTO resources VALUES(?,?,1,\'tool\',\'ready\',?,?)').run(resource, podId, name, JSON.stringify({ ...configuration, capability }))
    return { resource, capability }
  }
  const tool = (origin: string, methods: string[]) => assign(origin, { type: 'http', origin, methods })
  const bind = (alias: string, resource: string, identity: string | null = null) => view = importer.bind(id, importer.view(id).revision, 'fixture', alias, resource, identity ? { identity, executableHash: 'b'.repeat(64) } : null)
  store.db.prepare('INSERT INTO resources VALUES(?,?,1,\'credential\',\'ready\',\'token\',?)').run(randomUUID(), podId, JSON.stringify({ alias: 'token', credentialId: randomUUID() }))
  const other = tool('https://other.example.test', ['GET']); const narrow = tool('https://api.example.test', ['POST']); const api = tool('https://api.example.test', ['GET', 'POST'])
  const signed = assign('signed', { type: 'http', origin: 'https://api.example.test', methods: ['GET'], authentication: { type: 'ddisaAgent', credential: 'token', subject: 'agent@id.example.test', issuer: 'https://id.example.test' } })
  for (const [alias, resource] of [['api', other.resource], ['api', narrow.resource], ['api', signed.resource], ['token', api.resource], ['undeclared', api.resource]]) expect(() => bind(alias!, resource!), `${alias}`).toThrow('does not match')
  expect(() => importer.bind(id, view.revision - 1, 'fixture', 'api', api.resource, null)).toThrow('Import changed')
  bind('api', api.resource)
  expect(open()).toEqual(['access:inbox', 'access:archive', 'application:cli'])
  expect(JSON.parse(String(store.db.prepare('SELECT capabilities FROM script_drafts WHERE pod_id=?').get(podId)!.capabilities))).toEqual(['credential.token', api.capability])
  const inbox = join(realpathSync(root), 'inbox'); mkdirSync(inbox)
  await resources.assignDirectory(podId, inbox, 'readWrite', resources.epoch(podId))
  const directory = () => resources.list(podId).find(item => item.kind === 'directory' && item.state === 'ready')!
  expect(() => bind('inbox', directory().id)).toThrow('does not match')
  resources.revoke(podId, directory().id, directory().revision); await resources.assignDirectory(podId, inbox, 'read', resources.epoch(podId))
  bind('inbox', directory().id); bind('archive', directory().id)
  expect(open()).toEqual(['application:cli'])
  const wrongTool = assign('Other CLI', { type: 'program', cliId: 'other-cli', environment: { REGION: 'eu' } }); const wrongRegion = assign('Tool CLI', { type: 'program', cliId: 'tool-cli', environment: { REGION: 'us' } })
  const bundle = assign('Tool App', { type: 'program', cliId: 'ai.openape.pods.launch', bundlePath: '/Applications/Tool.app', executableHash: 'b'.repeat(64), environment: { REGION: 'eu' } }); const cli = assign('Tool CLI', { type: 'program', cliId: 'tool-cli', environment: { REGION: 'eu' } })
  for (const [resource, identity] of [[wrongTool.resource, null], [wrongRegion.resource, null], [bundle.resource, null], [bundle.resource, 'other.bundle']] as const) expect(() => bind('cli', resource, identity)).toThrow('does not match')
  bind('cli', bundle.resource, 'tool-cli')
  expect(open()).toEqual([])
  store.db.prepare('UPDATE resources SET configuration=json_set(configuration,\'$.executableHash\',?) WHERE id=?').run('c'.repeat(64), bundle.resource)
  expect(open()).toEqual(['application:cli'])
  expect(() => bind('cli', bundle.resource, 'tool-cli')).toThrow('does not match')
  bind('cli', cli.resource)
  expect(view.unresolved).toEqual([])
  expect(JSON.parse(String(store.db.prepare('SELECT capabilities FROM script_drafts WHERE pod_id=?').get(podId)!.capabilities))).toEqual(['credential.token', api.capability, cli.capability])
  const reference = resources.list(podId).find(item => item.kind === 'reference')!
  expect(runAliases(resources.aliases(podId), [{ id: reference.id, hash: 'a'.repeat(64), path: '/snapshot/template.txt' }])).toEqual({ applications: { cli: 'Tool CLI' }, http: { api: 'https://api.example.test' }, directories: { archive: inbox, inbox }, references: { 'assets/template.txt': { id: reference.id, hash: 'a'.repeat(64), path: '/snapshot/template.txt' } } })
  expect(() => resources.alias(podId, 'Not a key', api.resource)).toThrow('invalid local key')
  expect(() => resources.alias(podId, 'api', randomUUID())).toThrow('current file, directory or tool')
  expect(() => importer.configure(id, view.revision, { pods: { fixture: { input_2: 6 } }, compositions: {} })).toThrow('now a Pod variable')
  view = importer.configure(id, view.revision, { pods: { fixture: { input_4: 'https://moved.example.test' } }, compositions: {} })
  expect(open()).toEqual(['access:api'])
  expect(() => importer.complete(id, view.revision)).toThrow('setup is incomplete')
  view = importer.configure(id, view.revision, { pods: { fixture: { input_4: null } }, compositions: {} })
  view = importer.complete(id, view.revision)
  expect(view.state).toBe('completed')
  resources.revoke(podId, api.resource, 1)
  expect(runAliases(resources.aliases(podId), []).http).toEqual({})
  bind('api', tool('https://api.example.test', ['GET']).resource)
  expect(runAliases(resources.aliases(podId), []).http).toEqual({ api: 'https://api.example.test' })
})

const engines = (workflows: WorkflowEngine): ImportEngines => ({ workflows, networks: null as never, catalog: null as never })
const schema = { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false }

async function networkFixture(withCall = false) {
  const script = { kind: 'script' as const, mediaType: 'text/javascript', content: bytes('export async function run() { return { status: "completed" } }') }
  const pod = (key: string, contract: { takes: string[], gives: string[], summary: string }, shared: boolean) => ({ key, title: `Imported ${key}`, description: '', script: `pods/${key}/run.mjs`, packages: null, contract, requestedCapabilities: [], access: [],
    inputs: shared ? [{ key: 'input_1', label: 'region', description: '', kind: 'string' as const, required: true, sharingGroup: 'shared_1_1' }] : [], bindings: shared ? [{ alias: 'region', input: 'input_1' }] : [], applications: [], assets: [] })
  const document = { version: 1, kind: 'network', formatVersion: 1, channels: [{ name: 'report.ready', title: 'Report ready', schemaVersion: 1, schema }], members: [{ pod: 'first', source: { schedule: { kind: 'interval', seconds: 600 } }, serialCase: false }, { pod: 'second', source: null, serialCase: false }], gates: [], joins: [],
    values: [{ name: 'region', input: 'input_1' }], legacyVariables: [], collections: [{ key: 'collection_1', name: 'reports', schema: 'data/flow/collection_1.json', retention: {}, access: [{ pod: 'second', operations: ['read', 'write'] }] }], artifacts: [{ key: 'artifacts_1', collection: 'collection_1', access: [{ pod: 'second', operations: ['read', 'create'] }] }], calls: withCall ? [{ pod: 'second', workflow: 'invoice' }] : [] }
  const invoice = { version: 1, kind: 'sequence', schedule: null, mail: null, ports: { version: 1, inputs: [{ name: 'invoice', version: 1, schema, pod: 'third' }], outputs: [{ name: 'result', version: 1, schema, pod: 'third' }], requiredTerminals: ['third'], requiredGates: [] } }
  return createPortablePackage({
    format: 'openape-package', version: 1, package: { key: 'flow', revision: 1, title: 'Portable network', description: '' }, requiredFeatures: ['portable_aliases_v1'], entry: { kind: 'network', key: 'flow' }, applications: [],
    pods: [pod('first', { takes: [], gives: ['report.ready'], summary: 'Creates reports' }, false), pod('second', { takes: ['report.ready'], gives: [], summary: 'Files reports' }, true), ...(withCall ? [{ ...pod('third', { takes: [], gives: [], summary: 'Reviews invoices' }, false), contract: null }] : [])],
    compositions: [{ key: 'flow', kind: 'network', title: 'Imported network', document: 'compositions/flow.json', documentVersion: 1, nodes: [{ pod: 'first', after: [], handoff: false }, { pod: 'second', after: [], handoff: false }], calls: withCall ? ['invoice'] : [], dataSchemas: ['data/flow/collection_1.json'],
      inputs: [{ key: 'input_1', label: 'region', description: '', kind: 'string', required: true, sharingGroup: 'shared_1_1' }] },
    ...(withCall ? [{ key: 'invoice', kind: 'sequence' as const, title: 'Invoice review', document: 'compositions/invoice.json', documentVersion: 1 as const, nodes: [{ pod: 'third', after: [], handoff: false }], calls: [], dataSchemas: [], inputs: [] }] : [])],
  }, [{ ...script, path: 'pods/first/run.mjs' }, { ...script, path: 'pods/second/run.mjs' }, ...(withCall ? [{ ...script, path: 'pods/third/run.mjs' }, { path: 'compositions/invoice.json', kind: 'composition' as const, mediaType: 'application/json', content: bytes(canonicalPortableJson(invoice)) }] : []), { path: 'compositions/flow.json', kind: 'composition', mediaType: 'application/json', content: bytes(canonicalPortableJson(document)) }, { path: 'data/flow/collection_1.json', kind: 'data-schema', mediaType: 'application/json', content: bytes(canonicalPortableJson({ version: 1, schema, indexes: [] })) }], '')
}

// Approves a member the way the network fixture does: a contract-bearing script version, active and validated for the current resources.
function approve(store: PodDatabase, resources: ResourceRegistry, podId: string, contract: { takes: string[], gives: string[], summary: string }): void {
  installExample(store, resources, podId, 'deterministic', 'a'.repeat(64))
  const manifest = JSON.parse(String(store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(podId)!.manifest)) as Record<string, unknown>
  const code = `export const contract=${JSON.stringify(contract)};\nexport async function run(context) { return {status:'completed',summary:'Synthetic',completedInputIds:context.input.eventIds,gapIds:[]}; }\n`
  const hash = digest(code); store.storeScript(podId, { ...manifest, contentHash: hash, contract }, code)
  const pod = store.getPod(podId)
  store.db.prepare('UPDATE pods SET active_script=? WHERE id=?').run(hash, podId)
  store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(podId, hash, pod.bindingRevision, resources.epoch(podId), JSON.stringify({ synthetic: true }))
}

it('creates an imported persistent network paused with shared values, data access and published member definitions', async () => {
  const { store, resources, importer } = workspace(); const exported = await networkFixture(); const id = randomUUID()
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime)
  const real: ImportEngines = { workflows: new WorkflowEngine(store, { start: () => { throw new Error('Import must not execute') }, cancelPod: () => {} }, { inspect: async () => {} }), networks: new NetworkEngine(store, dispatcher, resources, '/unused', () => owner), catalog: new DefinitionCatalog(store, resources, owner) }
  const groups = new PodGroups(store); groups.execute({ type: 'organize', action: 'create', name: 'Delta', revision: groups.view().revision }); const groupId = groups.view().groups[0]!.id
  let view = await importer.stage(id, exported.archive)
  expect(view.unresolved.map(item => `${item.scope}:${item.requirement}:${item.name}`)).toEqual(['pod:value:input_1', 'composition:value:input_1', 'composition:composition:null'])
  view = importer.configure(id, view.revision, { pods: {}, compositions: { flow: { input_1: 'eu' } } })
  view = await importer.commit(id, view.revision); const [first, second] = view.pods.map(pod => pod.podId) as [string, string]
  expect(new PodVariables(store).values(second)).toEqual({ region: 'eu' })
  await expect(importer.finalize(id, view.revision, 'flow', groupId, {}, real)).rejects.toThrow('Finish Pod setup and approve')
  view = importer.complete(id, view.revision)
  expect(view).toMatchObject({ state: 'completed', unresolved: [{ scope: 'composition', key: 'flow' }] })
  await expect(importer.finalize(id, view.revision, 'flow', groupId, {}, real)).rejects.toThrow('Validate and activate the script')
  approve(store, resources, first, { takes: [], gives: ['report.ready'], summary: 'Creates reports' }); approve(store, resources, second, { takes: ['report.ready'], gives: [], summary: 'Files reports' })
  const existing = randomUUID()
  store.transaction(() => {
    store.db.prepare('INSERT INTO data_collections VALUES(?,?,?,?,?,1,?)').run(existing, owner.issuer, owner.subject, groupId, 'reports', '{}')
    store.db.prepare('INSERT INTO data_collection_versions VALUES(?,1,?,?,0)').run(existing, JSON.stringify({ ...schema, properties: { other: { type: 'string' } }, required: ['other'] }), '[]')
  })
  await expect(importer.finalize(id, view.revision, 'flow', groupId, {}, real)).rejects.toThrow('already exists in this group')
  await expect(importer.finalize(id, view.revision, 'flow', groupId, { collection_1: existing }, real)).rejects.toThrow('different schema')
  expect(store.db.prepare('SELECT count(*) AS count FROM networks').get()!.count).toBe(0)
  expect(store.db.prepare('SELECT count(*) AS count FROM pod_memberships WHERE group_id=?').get(groupId)!.count).toBe(0)
  expect(importer.list().map(item => item.id)).toEqual([id])
  store.db.prepare('UPDATE data_collection_versions SET schema=?').run(JSON.stringify(schema))
  view = await importer.finalize(id, view.revision, 'flow', groupId, { collection_1: existing }, real)
  const networkId = view.compositions[0]!.networkId!
  expect(view.unresolved).toEqual([])
  expect(real.networks.execute({ type: 'list' }).networks.find(item => item.id === networkId)).toMatchObject({ state: 'paused', groupId, name: 'Imported network' })
  expect(store.db.prepare('SELECT pod_id FROM network_members WHERE network_id=? ORDER BY rowid').all(networkId).map(row => row.pod_id)).toEqual([first, second])
  expect(store.db.prepare('SELECT name,value FROM composition_config WHERE network_id=?').all(networkId)).toEqual([{ name: 'region', value: '"eu"' }])
  expect(store.db.prepare('SELECT s.state,c.name,c.value FROM instance_definition_bindings b JOIN pod_definition_sources s ON s.definition_id=b.definition_id AND s.version=b.definition_version LEFT JOIN definition_config c ON c.definition_id=b.definition_id AND c.definition_version=b.definition_version WHERE b.pod_id=?').all(second)).toEqual([{ state: 'published', name: 'region', value: '"eu"' }])
  expect(store.db.prepare('SELECT id,name,group_id FROM data_collections').all()).toEqual([{ id: existing, name: 'reports', group_id: groupId }])
  expect(store.db.prepare('SELECT pod_id,operation FROM data_permissions WHERE network_id=? ORDER BY operation').all(networkId)).toEqual([{ pod_id: second, operation: 'read' }, { pod_id: second, operation: 'write' }])
  expect(store.db.prepare('SELECT count(*) AS count FROM artifact_scopes WHERE collection_id IS NOT NULL').get()!.count).toBe(1)
  expect(store.db.prepare('SELECT operation FROM artifact_permissions WHERE network_id=? ORDER BY operation').all(networkId).map(row => row.operation)).toEqual(['create', 'read'])
  expect(store.db.prepare('SELECT count(*) AS count FROM pod_memberships WHERE group_id=?').get(groupId)!.count).toBe(2)
  expect((await importer.finalize(id, view.revision, 'flow', groupId, {}, real)).compositions).toEqual(view.compositions)
  expect(store.db.prepare('SELECT count(*) AS count FROM networks').get()!.count).toBe(1)
  expect(store.db.prepare('SELECT archive_hash FROM portable_imports WHERE id=?').get(id)!.archive_hash).toBeNull()
  expect(importer.list()).toEqual([])
})

it('lets the owner abandon deferred compositions of a completed import and releases its archive', async () => {
  const { store, importer } = workspace(); const id = randomUUID(); await importer.stage(id, (await networkFixture()).archive)
  let view = importer.configure(id, 1, { pods: {}, compositions: { flow: { input_1: 'eu' } } })
  view = await importer.commit(id, view.revision); view = importer.complete(id, view.revision)
  expect(importer.list().map(item => item.id)).toEqual([id])
  view = importer.cancel(id, view.revision)
  expect(view).toMatchObject({ state: 'completed', unresolved: [] })
  expect(store.db.prepare('SELECT archive_hash FROM portable_imports WHERE id=?').get(id)!.archive_hash).toBeNull()
  expect(importer.list()).toEqual([])
  expect(store.listPods()).toHaveLength(2)
})

it('publishes a called workflow revision and grants the network member its call', async () => {
  const { store, resources, importer } = workspace(); const exported = await networkFixture(true); const id = randomUUID()
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime)
  const real: ImportEngines = { workflows: new WorkflowEngine(store, { start: () => { throw new Error('Import must not execute') }, cancelPod: () => {} }, { inspect: async () => {} }), networks: new NetworkEngine(store, dispatcher, resources, '/unused', () => owner), catalog: new DefinitionCatalog(store, resources, owner) }
  const groups = new PodGroups(store); groups.execute({ type: 'organize', action: 'create', name: 'Delta', revision: groups.view().revision }); const groupId = groups.view().groups[0]!.id
  let view = await importer.stage(id, exported.archive)
  view = importer.configure(id, view.revision, { pods: {}, compositions: { flow: { input_1: 'eu' } } })
  view = await importer.commit(id, view.revision); const [first, second, third] = view.pods.map(pod => pod.podId) as [string, string, string]
  view = importer.complete(id, view.revision)
  expect(view.unresolved.map(item => item.key).sort()).toEqual(['flow', 'invoice'])
  approve(store, resources, first, { takes: [], gives: ['report.ready'], summary: 'Creates reports' }); approve(store, resources, second, { takes: ['report.ready'], gives: [], summary: 'Files reports' })
  await expect(importer.finalize(id, view.revision, 'flow', groupId, {}, real)).rejects.toThrow('Create the called workflow before')
  await expect(importer.finalize(id, view.revision, 'invoice', groupId, {}, real)).rejects.toThrow('Validate and activate the script')
  approve(store, resources, third, { takes: [], gives: [], summary: 'Reviews invoices' })
  await expect(importer.finalize(id, view.revision, 'invoice', null, {}, real)).rejects.toThrow('called workflow needs an existing group')
  view = await importer.finalize(id, view.revision, 'invoice', groupId, {}, real)
  expect(real.workflows.view().workflows.find(item => item.id === view.compositions[0]!.workflowId)).toMatchObject({ enabled: false, groupId, nodes: [{ podId: third }] })
  expect(store.db.prepare('SELECT group_id FROM pod_memberships WHERE pod_id=?').get(third)!.group_id).toBe(groupId)
  view = await importer.finalize(id, view.revision, 'flow', groupId, {}, real)
  const networkId = view.compositions.find(item => item.key === 'flow')!.networkId!
  expect(view.unresolved).toEqual([])
  expect(store.db.prepare('SELECT archive_hash FROM portable_imports WHERE id=?').get(id)!.archive_hash).toBeNull()
  const permission = store.db.prepare('SELECT workflow_id,workflow_revision,pod_id,enabled FROM workflow_call_permissions WHERE network_id=?').get(networkId)!
  expect(permission).toMatchObject({ workflow_id: view.compositions.find(item => item.key === 'invoice')!.workflowId, workflow_revision: 1, pod_id: second, enabled: 1 })
  expect(store.db.prepare('SELECT count(*) AS count FROM workflow_revisions WHERE workflow_id=?').get(permission.workflow_id as string)!.count).toBe(1)
})

async function workflowFixture(kind: 'sequence' | 'channels', ports: unknown = null) {
  const script = { kind: 'script' as const, mediaType: 'text/javascript', content: bytes('export async function run() { return { status: "completed" } }') }
  const pod = (key: string, contract: { takes: string[], gives: string[], summary: string } | null) => ({ key, title: `Imported ${key}`, description: '', script: `pods/${key}/run.mjs`, packages: null, contract, requestedCapabilities: [], access: [], inputs: [], bindings: [], applications: [], assets: [] })
  const document = kind === 'sequence'
    ? { version: 1, kind, schedule: { kind: 'daily', time: '07:00', timezone: 'Europe/Vienna' }, ports, mail: null }
    : { version: 1, kind, schedule: null, channels: [{ name: 'report.ready', title: 'Report ready', fields: ['id'] }], gates: [], values: [{ name: 'region', input: 'input_1' }], ports: null }
  return createPortablePackage({
    format: 'openape-package', version: 1, package: { key: 'flow', revision: 1, title: 'Portable flow', description: '' }, requiredFeatures: ['portable_aliases_v1'], entry: { kind, key: 'flow' }, applications: [],
    pods: [pod('first', kind === 'channels' ? { takes: [], gives: ['report.ready'], summary: 'Creates reports' } : null), pod('second', kind === 'channels' ? { takes: ['report.ready'], gives: [], summary: 'Files reports' } : null)],
    compositions: [{ key: 'flow', kind, title: 'Imported flow', document: 'compositions/flow.json', documentVersion: 1, nodes: [{ pod: 'first', after: [], handoff: false }, { pod: 'second', after: kind === 'sequence' ? ['first'] : [], handoff: kind === 'sequence' }], calls: [], dataSchemas: [],
      inputs: kind === 'channels' ? [{ key: 'input_1', label: 'region', description: '', kind: 'string', required: true, sharingGroup: null }] : [] }],
  }, [{ ...script, path: 'pods/first/run.mjs' }, { ...script, path: 'pods/second/run.mjs' }, { path: 'compositions/flow.json', kind: 'composition', mediaType: 'application/json', content: bytes(canonicalPortableJson(document)) }], '')
}

it('creates an imported sequence disabled and hands outputs over under package keys once members are approved', async () => {
  const { store, resources, importer } = workspace(); const id = randomUUID(); await importer.stage(id, (await workflowFixture('sequence')).archive)
  const runs = new RunStore(store); const started: { podId: string, id: string }[] = []
  const engine = new WorkflowEngine(store, { start: (podId, trigger) => { const run = runs.reserve(podId, store.getPod(podId).activeScript!, resources.epoch(podId), trigger).run; started.push({ podId, id: run.id }); return run.id }, cancelPod: () => {} }, { inspect: async () => {} })
  let view = await importer.commit(id, 1); const [first, second] = view.pods.map(pod => pod.podId) as [string, string]
  expect(view.unresolved).toEqual([{ scope: 'composition', key: 'flow', requirement: 'composition', name: null }])
  expect(() => importer.complete(id, view.revision)).toThrow('setup is incomplete')
  await expect(importer.finalize(id, view.revision, 'flow', randomUUID(), {}, engines(engine))).rejects.toThrow('a plain sequence has none')
  await expect(importer.finalize(id, view.revision, 'other', null, {}, engines(engine))).rejects.toThrow('Unknown package composition')
  view = await importer.finalize(id, view.revision, 'flow', null, {}, engines(engine)); const workflowId = view.compositions[0]!.workflowId!
  expect(view).toMatchObject({ unresolved: [], compositions: [{ key: 'flow', networkId: null }] })
  expect(engine.view().workflows.find(item => item.id === workflowId)).toMatchObject({ name: 'Imported flow', enabled: false, schedule: { kind: 'daily', time: '07:00' }, nodes: [{ podId: first, after: [], handoff: false }, { podId: second, after: [first], handoff: true }] })
  for (const revision of [view.revision - 1, view.revision]) expect((await importer.finalize(id, revision, 'flow', null, {}, engines(engine))).compositions).toEqual(view.compositions)
  expect(engine.view().workflows).toHaveLength(1)
  engine.start(workflowId, 1); engine.tick()
  const refused = store.db.prepare('SELECT id FROM workflow_runs WHERE finished_at IS NULL').get()!.id as string
  expect(started).toEqual([]); expect(engine.run(refused).state).toBe('blocked')
  await engine.cancel(refused)
  importer.complete(id, view.revision)
  for (const podId of [first, second]) { installExample(store, resources, podId, 'deterministic', 'a'.repeat(64)); store.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id=?').run(podId) }
  engine.start(workflowId, 1); engine.tick()
  const result = { schema: 'synthetic-result/v1', data: { batchId: 'fixed' } }
  publishWorkflowOutput(store, started[0]!.id, result); runs.finish(started[0]!.id, 'completed', 'Synthetic result', null, []); engine.tick()
  expect(workflowInput(store, started[1]!.id)).toMatchObject({ outputs: { [first]: result }, outputsByKey: { first: result } })
  runs.finish(started[1]!.id, 'completed', 'Synthetic result', null, []); engine.tick()
  const local = store.createPod({ name: 'Local consumer' }); installExample(store, resources, local.id, 'deterministic', 'a'.repeat(64)); store.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id=?').run(local.id)
  const mixed = randomUUID(); engine.save({ type: 'save', id: mixed, revision: 0, name: 'Mixed', nodes: [{ podId: first, after: [], handoff: false }, { podId: local.id, after: [first], handoff: true }], schedule: null, enabled: false })
  engine.start(mixed, 1); engine.tick()
  publishWorkflowOutput(store, started[2]!.id, result); runs.finish(started[2]!.id, 'completed', 'Synthetic result', null, []); engine.tick()
  expect(workflowInput(store, started[3]!.id)).toEqual({ runId: expect.any(String), outputs: { [first]: result } })
})

it('defers ported workflows to approved members and drops a composition that lost a member', async () => {
  const { store, importer } = workspace(); const schema = { type: 'object', properties: { invoice: { type: 'string' } }, required: ['invoice'], additionalProperties: false }
  const ported = await workflowFixture('sequence', { version: 1, inputs: [{ name: 'invoice', version: 1, schema, pod: 'first' }], outputs: [{ name: 'result', version: 1, schema, pod: 'second' }], requiredTerminals: ['second'], requiredGates: [] })
  const deferred = await importer.stage(randomUUID(), ported.archive)
  expect(deferred.unresolved).toEqual([{ scope: 'composition', key: 'flow', requirement: 'composition', name: null }])
  importer.cancel(deferred.id, deferred.revision)
  const id = randomUUID(); await importer.stage(id, (await workflowFixture('sequence')).archive)
  const view = await importer.commit(id, 1)
  store.updatePod(view.pods[0]!.podId, store.getPod(view.pods[0]!.podId).revision, { name: 'Imported first', lifecycle: 'archived' })
  expect(importer.view(id).unresolved).toEqual([])
  deletePod(store, view.pods[0]!.podId)
  expect(importer.view(id)).toMatchObject({ pods: [{ key: 'second' }], unresolved: [] })
  expect(importer.complete(id, view.revision).state).toBe('completed')
})

it('creates an imported channel graph in a chosen group with its declared shared values', async () => {
  const { store, importer } = workspace(); const id = randomUUID(); await importer.stage(id, (await workflowFixture('channels')).archive)
  const engine = new WorkflowEngine(store, { start: () => { throw new Error('Import must not execute') }, cancelPod: () => {} }, { inspect: async () => {} })
  const groups = new PodGroups(store); groups.execute({ type: 'organize', action: 'create', name: 'Delta', revision: groups.view().revision })
  const groupId = groups.view().groups.find(group => group.name === 'Delta')!.id
  let view = await importer.commit(id, 1)
  await expect(importer.finalize(id, view.revision, 'flow', groupId, {}, engines(engine))).rejects.toThrow('setup is incomplete')
  view = importer.configure(id, view.revision, { pods: {}, compositions: { flow: { input_1: 'eu' } } })
  await expect(importer.finalize(id, view.revision, 'flow', null, {}, engines(engine))).rejects.toThrow('needs an existing group')
  await expect(importer.finalize(id, view.revision, 'flow', randomUUID(), {}, engines(engine))).rejects.toThrow('needs an existing group')
  groups.execute({ type: 'organize', action: 'create', name: 'Other', revision: groups.view().revision })
  const other = groups.view().groups.find(group => group.name === 'Other')!.id
  store.db.prepare('INSERT INTO pod_memberships VALUES(?,?)').run(view.pods[0]!.podId, other)
  await expect(importer.finalize(id, view.revision, 'flow', groupId, {}, engines(engine))).rejects.toThrow('already belongs to another group')
  expect(store.db.prepare('SELECT count(*) AS count FROM pod_memberships WHERE group_id=?').get(groupId)!.count).toBe(0)
  store.db.prepare('DELETE FROM pod_memberships WHERE group_id=?').run(other)
  view = await importer.finalize(id, view.revision, 'flow', groupId, {}, engines(engine))
  expect(view.unresolved).toEqual([])
  expect(engine.view().workflows[0]).toMatchObject({ mode: 'channels', groupId, enabled: false, channels: [{ name: 'report.ready' }], values: [{ name: 'region', value: 'eu' }] })
  expect(store.db.prepare('SELECT count(*) AS count FROM pod_memberships WHERE group_id=?').get(groupId)!.count).toBe(2)
  expect(importer.complete(id, view.revision).state).toBe('completed')
})

it('recovers interrupted staging and commit as a pending import or one complete copy', async () => {
  const { store, importer } = workspace(); const exported = await packageFixture(); const retention = new DataRetention(store, 'unused-helper')
  const lost = randomUUID()
  await expect(importer.stage(lost, exported.archive, (point) => { if (point === 'renamed') throw new Error('crash after blob') })).rejects.toThrow('crash after blob')
  expect(() => importer.view(lost)).toThrow('Import not found')
  await retention.cleanup(); expect(readdirSync(store.blobs)).toEqual([])
  const id = randomUUID(); const staged = await importer.stage(id, exported.archive); const podId = staged.pods[0]!.podId
  importer.configure(id, 1, { pods: { fixture: { input_2: 5 } }, compositions: {} })
  await retention.cleanup(); expect(readdirSync(store.blobs)).toEqual([exported.transferSha256])
  for (const point of ['staged', 'beforeCommit'] as const) {
    await expect(importer.commit(id, 2, (reached) => { if (reached === point) throw new Error(`crash at ${point}`) })).rejects.toThrow(`crash at ${point}`)
    expect(importer.view(id)).toMatchObject({ state: 'staged', revision: 2 }); expect(store.listPods()).toEqual([])
    expect(existsSync(join(store.root, 'pods', podId))).toBe(false)
  }
  mkdirSync(join(store.root, 'pods', podId, 'workspace', 'assets'), { recursive: true })
  await recoverPortableImports(store)
  expect(existsSync(join(store.root, 'pods', podId))).toBe(false)
  await expect(importer.commit(id, 2, (reached) => { if (reached === 'committed') throw new Error('crash after commit') })).rejects.toThrow('crash after commit')
  await recoverPortableImports(store)
  expect(importer.view(id)).toMatchObject({ state: 'committed', pods: [{ key: 'fixture', podId }] })
  expect(store.listPods().map(pod => pod.id)).toEqual([podId])
  expect(existsSync(join(store.root, 'pods', podId, 'workspace', 'assets', 'template.txt'))).toBe(true)
})

it('cancels only pending imports and forgets journals whose Pods were deleted', async () => {
  const { store, importer } = workspace(); const exported = await packageFixture(); const existing = store.createPod({ name: 'Existing' })
  const pending = randomUUID(); const staged = await importer.stage(pending, exported.archive)
  expect(() => importer.cancel(pending, 2)).toThrow('Import changed')
  const racing = importer.commit(pending, 1, (point) => { if (point === 'staged') throw new Error('refused') })
  expect(() => importer.cancel(pending, 1)).toThrow('Import changed')
  await expect(importer.commit(pending, 1)).rejects.toThrow('Import changed')
  await expect(racing).rejects.toThrow('refused')
  expect(existsSync(join(store.root, 'pods', staged.pods[0]!.podId))).toBe(false)
  expect(importer.cancel(pending, 1)).toMatchObject({ state: 'cancelled', pods: [] })
  expect(importer.cancel(pending, 1)).toMatchObject({ state: 'cancelled' })
  await new DataRetention(store, 'unused-helper').cleanup(); expect(readdirSync(store.blobs)).toEqual([])
  const ids = Array.from({ length: 8 }, () => randomUUID())
  for (const id of ids) await importer.stage(id, exported.archive)
  await expect(importer.stage(randomUUID(), exported.archive)).rejects.toThrow('Finish or cancel an existing import')
  importer.configure(ids[0]!, 1, { pods: { fixture: { input_2: 5 } }, compositions: {} })
  const committed = await importer.commit(ids[0]!, 2); const podId = committed.pods[0]!.podId
  expect(() => importer.cancel(ids[0]!, committed.revision)).toThrow('already exists')
  expect(store.listPods()).toHaveLength(2)
  deletePod(store, podId)
  expect(importer.view(ids[0]!)).toMatchObject({ state: 'committed', pods: [], unresolved: [] })
  expect(importer.list().map(item => item.id)).toEqual(ids.slice(1))
  expect((await importer.stage(randomUUID(), exported.archive)).state).toBe('staged')
  expect(() => importer.view(ids[0]!)).toThrow('Import not found')
  expect(() => importer.view(pending)).toThrow('Import not found')
  expect(store.listPods().map(pod => pod.id)).toEqual([existing.id])
})

it('migrates schema 33 with a verified copy and restores unfinished imports closed', async () => {
  const { root, store } = workspace(); const exported = await packageFixture()
  for (const table of [...aliasTables, ...sharingTables].reverse()) store.db.exec(`DROP TABLE ${table}`)
  store.db.exec('DROP TABLE network_choices; PRAGMA user_version=33'); store.close(); stores.splice(stores.indexOf(store), 1)
  const migrated = new PodDatabase(store.root); stores.push(migrated)
  expect(migrated.db.prepare('PRAGMA user_version').get()!.user_version).toBe(schemaVersion)
  expect(readdirSync(store.root).filter(file => file.startsWith('before-v33-'))).toHaveLength(1)
  migrated.close(); stores.splice(stores.indexOf(migrated), 1)
  const reopened = new PodDatabase(store.root); stores.push(reopened)
  const current = new PortableImporter(reopened, new ResourceRegistry(reopened, () => {}), owner, '')
  const pending = randomUUID(); await current.stage(pending, exported.archive)
  const id = randomUUID(); await current.stage(id, exported.archive); current.configure(id, 1, { pods: { fixture: { input_2: 5 } }, compositions: {} }); await current.commit(id, 2)
  const backup = await createBackup(reopened, root)
  expect(existsSync(join(backup, 'blobs', exported.transferSha256))).toBe(false)
  const restored = new PodDatabase(await restoreBackup(backup, root, schemaVersion)); stores.push(restored)
  const after = new PortableImporter(restored, new ResourceRegistry(restored, () => {}), owner, '')
  expect(after.view(pending)).toMatchObject({ state: 'cancelled', error: 'Restored profile: import the package again' })
  const view = after.view(id)
  expect(view).toMatchObject({ state: 'committed', error: 'Restored profile: import the package again' })
  const path = JSON.parse(String(restored.db.prepare('SELECT configuration FROM resources WHERE pod_id=? AND kind=\'reference\'').get(view.pods[0]!.podId)!.configuration)).path as string
  expect(path.startsWith(`${realpathSync(restored.root)}/pods/`)).toBe(true)
  expect(readFileSync(path, 'utf8')).toBe('Reusable template')
  expect(restored.db.prepare('SELECT count(*) AS count FROM portable_imports WHERE archive_hash IS NOT NULL').get()!.count).toBe(0)
  await expect(after.commit(id, 3)).resolves.toMatchObject({ state: 'committed' })
})
