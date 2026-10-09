// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { afterEach, expect, it, vi } from 'vitest'
import { networkFixture, closeNetworks } from '../scheduling/network-fixture'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { PodVariables } from '../../src/worker/resources/variables'
import { installExample } from '../../src/worker/runs/examples'
import { capturePortableSource } from '../../src/worker/sharing/source'
import { PortableExporter } from '../../src/worker/sharing/export'
import { readPortableAssets } from '../../src/worker/sharing/assets'
import { DefinitionCatalog } from '../../src/worker/workspace/definition-catalog'
import { mapPortableSource } from '../../src/worker/sharing/mapping'
import type { PortableExportChoices } from '../../src/worker/sharing/mapping'
import { createPortablePackage, exportFormatFeatures, validatePortableFiles } from '../../src/worker/sharing/package'
import type { PortableDescription, PortablePayload } from '../../src/worker/sharing/package'
import { scanPortableFiles } from '../../src/worker/sharing/scan'
import { programDefinition } from '../../src/main/programs/definition'
import { portableScriptSource } from '../../src/worker/sharing/pod'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))

const bytes = (value: string) => new TextEncoder().encode(value)
const stores: PodDatabase[] = []
const assetRoots: string[] = []
afterEach(async () => {
  await closeNetworks()
  for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) }
  for (const root of assetRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function sourceFixture() {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-sharing-export-'))); stores.push(store)
  const pod = store.createPod({ name: 'Export fixture' }); const resources = new ResourceRegistry(store, () => {})
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  const owner = { issuer: 'https://id.example.test', subject: 'export-owner' }
  const selection = { kind: 'pod' as const, id: pod.id }
  return { store, pod, owner, selection, resources }
}
function mappingChoices(source: ReturnType<typeof capturePortableSource>): PortableExportChoices {
  return {
    package: { key: 'fixture', revision: 1, title: 'Portable fixture', description: '' },
    pods: source.pods.map((pod, index) => ({ podId: pod.pod.id, key: `pod_${index + 1}`, description: '', defaults: [], aliases: [], assets: [] })),
    compositions: (source.network ? [source.network.definition.id] : []).map((id, index) => ({ id, key: `composition_${index + 1}`, defaults: [] })),
  }
}
function fixture() {
  const description: PortableDescription = {
    format: 'openape-package', version: 1, package: { key: 'fixture', revision: 1, title: 'Portable fixture', description: '' }, requiredFeatures: ['portable_aliases_v1'],
    entry: { kind: 'pod', key: 'fixture' }, applications: [], compositions: [],
    pods: [{ key: 'fixture', title: 'Fixture', description: '', script: 'pods/fixture.mjs', packages: null, contract: null, requestedCapabilities: [], access: [], inputs: [], bindings: [], applications: [], assets: ['assets/template.txt'] }],
  }
  const payloads: PortablePayload[] = [{ path: 'pods/fixture.mjs', kind: 'script', mediaType: 'text/javascript', content: bytes('export async function run() { return { status: "completed" } }') }, { path: 'assets/template.txt', kind: 'asset', mediaType: 'text/plain', content: bytes('Reusable template') }]
  return { description, payloads }
}
it('produces deterministic content and transfer digests with only declared files', async () => {
  const f = fixture(); const first = await createPortablePackage(f.description, f.payloads, '')
  expect(() => validatePortableFiles(first.manifest, new Map(f.payloads.map(file => [file.path, file.content])), '', [])).toThrow('runtime does not support')
  const second = await createPortablePackage(f.description, [...f.payloads].reverse(), '')
  expect(first.manifest.contentSha256).toBe(second.manifest.contentSha256)
  expect(first.archive).toEqual(second.archive)
  expect(first.transferSha256).toBe(createHash('sha256').update(first.archive).digest('hex'))
  const archive = unzipSync(first.archive)
  expect(Object.keys(archive)).toEqual(['manifest.json', 'assets/template.txt', 'pods/fixture.mjs'])
  expect(JSON.parse(new TextDecoder().decode(archive['manifest.json']))).toEqual(first.manifest)
  expect(new TextDecoder().decode(archive['assets/template.txt'])).toBe('Reusable template')
  expect(validatePortableFiles(first.manifest, new Map(Object.entries(archive).filter(([path]) => path !== 'manifest.json')), '', exportFormatFeatures)).toEqual(first.manifest)
})
it('refuses mismatched content, inventory and manifest digests', async () => {
  const f = fixture(); const result = await createPortablePackage(f.description, f.payloads, '')
  const files = new Map(f.payloads.map(file => [file.path, file.content]))
  files.set('assets/template.txt', bytes('Different bytes'))
  expect(() => validatePortableFiles(result.manifest, files, '', exportFormatFeatures)).toThrow('bytes differ')
  files.delete('assets/template.txt')
  expect(() => validatePortableFiles(result.manifest, files, '', exportFormatFeatures)).toThrow('inventory differs')
  expect(() => validatePortableFiles({ ...result.manifest, contentSha256: '0'.repeat(64) }, new Map(f.payloads.map(file => [file.path, file.content])), '', exportFormatFeatures)).toThrow('digest does not match')
})
it('refuses duplicate paths, executable assets and oversized native scripts', async () => {
  const f = fixture()
  await expect(createPortablePackage(f.description, [...f.payloads, f.payloads[0]!], '')).rejects.toThrow('duplicate file paths')
  f.payloads[1]!.content = bytes('#!/bin/sh\nexit 0')
  await expect(createPortablePackage(f.description, f.payloads, '')).rejects.toThrow('executable payloads')
  f.payloads[1]!.content = bytes('template'); f.payloads[0]!.content = bytes('x'.repeat(200001))
  await expect(createPortablePackage(f.description, f.payloads, '')).rejects.toThrow('native character limit')
})

it('reports private references and likely credentials without copying their values into findings', async () => {
  const { scanPortableFiles } = await import('../../src/worker/sharing/scan')
  const identity = '22222222-2222-4222-8222-222222222222'; const secret = 'SYNTHETIC_PRIVATE_CREDENTIAL_VALUE'
  const source = `const source = "${identity}"\nconst folder = "/Users/fixture/private"\nconst token = "${secret}"\n`
  const findings = scanPortableFiles([{ path: 'pods/source.mjs', content: bytes(source), text: true }], [identity])
  expect(findings.map(finding => [finding.kind, finding.line, finding.severity])).toEqual([['local-reference', 1, 'block'], ['local-path', 2, 'block'], ['possible-credential', 3, 'review']])
  expect(JSON.stringify(findings)).not.toContain(identity); expect(JSON.stringify(findings)).not.toContain(secret)
  expect(scanPortableFiles([{ path: 'pods/source.mjs', content: bytes(source), text: true }], [identity])).toEqual(findings)
})

it('captures only current owned source metadata and invalidates changed variable revisions', () => {
  const f = sourceFixture(); const variables = new PodVariables(f.store)
  variables.save(f.pod.id, 'label', 'Reusable label', 0)
  f.store.commitProgress({ podId: f.pod.id, expectedRevision: 0, checkpoint: { privateToken: 'EXCLUDED_CHECKPOINT_CANARY' }, sources: [], claims: [] })
  const before = f.store.getPod(f.pod.id)
  const first = capturePortableSource(f.store, f.owner, f.selection)
  expect(first.pods[0]!.variables[0]!.value).toBe('Reusable label')
  expect(JSON.stringify(first)).not.toContain('EXCLUDED_CHECKPOINT_CANARY')
  expect(first.privateReferences).toContain(f.pod.id)
  expect(capturePortableSource(f.store, f.owner, f.selection).fingerprint).toBe(first.fingerprint)
  variables.save(f.pod.id, 'label', 'Changed label', 1)
  expect(capturePortableSource(f.store, f.owner, f.selection).fingerprint).not.toBe(first.fingerprint)
  expect(f.store.getPod(f.pod.id)).toEqual(before)
  f.store.db.prepare('DELETE FROM validations WHERE pod_id=?').run(f.pod.id)
  expect(() => capturePortableSource(f.store, f.owner, f.selection)).toThrow('Validate the current Pod')
})

it('rejects stale reviews, changed assets, cancellations and mutable client review copies', async () => {
  const f = sourceFixture(); let asset = 'Reviewed template'
  const exporter = new PortableExporter(f.store, f.owner, '', async () => {
    const content = fixture(); content.payloads[1]!.content = bytes(asset); return content
  })
  const review = await exporter.review(f.selection, {})
  const first = await exporter.commit(review.id, [])
  expect(await exporter.commit(review.id, [])).toEqual(first)
  review.manifest.package.title = 'Untrusted client mutation'
  expect((await exporter.commit(review.id, [])).manifest.package.title).toBe('Portable fixture')
  asset = 'Changed template'
  await expect(exporter.commit(review.id, [])).rejects.toThrow('source changed')
  asset = 'Reviewed template'
  new PodVariables(f.store).save(f.pod.id, 'changed', 'new', 0)
  await expect(exporter.commit(review.id, [])).rejects.toThrow('source changed')
  const next = await exporter.review(f.selection, {})
  exporter.cancel(next.id)
  await expect(exporter.commit(next.id, [])).rejects.toThrow('review expired')
})

it('requires exact privacy acknowledgements and never allows a blocked private reference', async () => {
  const f = sourceFixture(); let source = 'const token = "SYNTHETIC_PRIVATE_CREDENTIAL_VALUE"'
  const exporter = new PortableExporter(f.store, f.owner, '', async () => {
    const content = fixture(); content.payloads[0]!.content = bytes(source); return content
  })
  const review = await exporter.review(f.selection, {})
  expect(review.findings).toHaveLength(1)
  await expect(exporter.commit(review.id, [])).rejects.toThrow('Acknowledge each')
  await expect(exporter.commit(review.id, ['unknown'])).rejects.toThrow('Acknowledge each')
  await expect(exporter.commit(review.id, review.findings.map(finding => finding.id))).resolves.toHaveProperty('archive')
  source = `const sourcePod = "${f.pod.id}"`
  const blocked = await exporter.review(f.selection, {})
  await expect(exporter.commit(blocked.id, blocked.findings.map(finding => finding.id))).rejects.toThrow('Parameterize')
})

it('refuses a source owned by another definition owner', () => {
  const f = sourceFixture()
  new DefinitionCatalog(f.store, f.resources, { ...f.owner, subject: 'different-owner' }).adopt(f.pod.id)
  expect(() => capturePortableSource(f.store, f.owner, f.selection)).toThrow('another owner')
})

it('copies only selected static references and refuses private storage and symlinks', async () => {
  const f = sourceFixture()
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pods-sharing-assets-'))); assetRoots.push(root)
  const file = join(root, 'template.txt'); writeFileSync(file, 'Explicit reusable asset')
  const omitted = join(root, 'omitted.txt'); writeFileSync(omitted, 'UNSELECTED_STATIC_ASSET_CANARY')
  const reference = f.resources.assignReference(f.pod.id, 'Template', file)
  const unselected = f.resources.assignReference(f.pod.id, 'Omitted', omitted)
  installExample(f.store, f.resources, f.pod.id, 'deterministic', 'a'.repeat(64))
  const captured = capturePortableSource(f.store, f.owner, f.selection); const source = captured.pods[0]!
  const selection = [{ resourceId: reference.id, path: 'assets/template.txt', mediaType: 'text/plain' }]
  const files = await readPortableAssets(f.store.root, source, selection)
  expect(files).toHaveLength(1); expect(Buffer.from(files[0]!.content).toString()).toBe('Explicit reusable asset')
  expect(JSON.stringify(files)).not.toContain('UNSELECTED_STATIC_ASSET_CANARY')
  const choices = mappingChoices(captured); choices.pods[0]!.assets = selection
  await expect(mapPortableSource(f.store.root, captured, choices)).rejects.toThrow('explicitly omit')
  choices.pods[0]!.omittedReferences = [unselected.id]
  const content = await mapPortableSource(f.store.root, captured, choices)
  const exported = await createPortablePackage(content.description, content.payloads, '')
  const archive = unzipSync(exported.archive)
  expect(Buffer.from(archive['assets/template.txt']!).toString()).toBe('Explicit reusable asset')
  expect(Object.values(archive).map(file => Buffer.from(file).toString()).join('\n')).not.toContain('UNSELECTED_STATIC_ASSET_CANARY')
  const privateFile = join(realpathSync(f.store.root), 'private.txt'); writeFileSync(privateFile, 'PRIVATE_WORKSPACE_CANARY')
  source.resources.find(item => item.id === reference.id)!.configuration.path = privateFile
  await expect(readPortableAssets(f.store.root, source, selection)).rejects.toThrow('private workspace')
  const link = join(root, 'linked.txt'); symlinkSync(file, link)
  source.resources.find(item => item.id === reference.id)!.configuration.path = link
  await expect(readPortableAssets(f.store.root, source, selection)).rejects.toThrow('symbolic links')
  const executable = join(root, 'disguised.mjs'); writeFileSync(executable, 'export default 1')
  source.resources.find(item => item.id === reference.id)!.configuration.path = executable
  await expect(readPortableAssets(f.store.root, source, selection)).rejects.toThrow('executable payloads')
})

it('distinguishes URL paths and escapes from local paths and case-insensitive source identifiers', () => {
  const safe = 'const title = "Subject:\\n"; const url = "https://host/home/x"; const path = "/api/Users/42"'
  expect(scanPortableFiles([{ path: 'pods/source.mjs', content: bytes(safe), text: true }], [])).toEqual([])
  const identity = 'abcdef01-abcd-4abc-8abc-abcdefabcdef'
  const unsafe = `const id = "${identity.toUpperCase()}"; const path = "C:\\Users\\sample"; const home = "~/private"`
  const findings = scanPortableFiles([{ path: 'pods/source.mjs', content: bytes(unsafe), text: true }], [identity])
  expect(findings.map(item => item.kind)).toEqual(['local-reference', 'local-path', 'local-path'])
  const uri = scanPortableFiles([{ path: 'pods/source.mjs', content: bytes('file:///Users/name/private key:/etc/passwd'), text: true }], [])
  expect(uri).toHaveLength(2); expect(uri.every(item => item.severity === 'block')).toBe(true)
})

it('scans UTF-16 text, flags known private values and acknowledges opaque asset limits', () => {
  const utf16 = scanPortableFiles([{ path: 'assets/text.txt', content: Buffer.from('/Users/private/file', 'utf16le'), text: false }], [])
  expect(utf16).toMatchObject([{ kind: 'local-path', severity: 'block' }])
  const binary = scanPortableFiles([{ path: 'assets/image.png', content: Uint8Array.from([137, 80, 78, 71]), text: false }], [])
  expect(binary).toMatchObject([{ kind: 'opaque-asset', severity: 'review' }])
  const known = scanPortableFiles([{ path: 'pods/source.mjs', content: bytes('const mailbox = "owner@example.test"'), text: true }], [], ['owner@example.test'])
  expect(known).toMatchObject([{ kind: 'private-value', severity: 'review' }])
  expect(JSON.stringify(known)).not.toContain('owner@example.test')
})

it('removes only the exact generated terminal binding comment and preserves user code verbatim', () => {
  const f = sourceFixture(); const source = capturePortableSource(f.store, f.owner, f.selection).pods[0]!
  source.manifest.capabilities = [`tool.app_${f.pod.id.replaceAll('-', '')}.invoke`]
  const trailer = `\n/* Pods binding: assignment ${source.manifest.assignmentRevision}; dependencies ${source.manifest.dependencyLockHash}; capabilities ${source.manifest.capabilities.join(',')} */\n`
  const code = `const originalSourceId = "${f.pod.id}";\nexport async function run() {}\n`
  source.content = code + trailer
  expect(portableScriptSource(source)).toBe(code)
  expect(scanPortableFiles([{ path: 'pods/source.mjs', content: bytes(portableScriptSource(source)), text: true }], [f.pod.id])).toMatchObject([{ kind: 'local-reference', severity: 'block' }])
  source.content = `${trailer}${code}`
  expect(portableScriptSource(source)).toBe(source.content)
  source.content = code + trailer.replace('assignment 1', 'assignment 999')
  expect(portableScriptSource(source)).toBe(source.content)
})

it('captures and maps an owned persistent network without source identities or runtime pause state', async () => {
  const f = networkFixture()
  const source = f.pod('Source', { takes: [], gives: ['work.ready'], summary: 'Produce' }, async () => {})
  const target = f.pod('Target', { takes: ['work.ready'], gives: [], summary: 'Consume' }, async () => {})
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: target, source: null, serialCase: false }], ['work.ready'])
  const selected = { kind: 'network' as const, id }
  const first = capturePortableSource(f.store, f.owner, selected)
  expect(first.pods.map(item => item.pod.id)).toEqual([source, target])
  expect(first.network!.definition.members).toHaveLength(2)
  f.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(source)
  expect(capturePortableSource(f.store, f.owner, selected).fingerprint).toBe(first.fingerprint)
  expect(() => capturePortableSource(f.store, { ...f.owner, subject: 'another-owner' }, selected)).toThrow('export owner')
  const content = await mapPortableSource(f.store.root, first, mappingChoices(first))
  const exported = await createPortablePackage(content.description, content.payloads, '')
  expect(exported.manifest.entry).toEqual({ kind: 'network', key: 'composition_1' })
  const serialized = Object.values(unzipSync(exported.archive)).map(file => Buffer.from(file).toString()).join('\n')
  for (const id of [source, target, first.network!.definition.id, f.groupId]) expect(serialized).not.toContain(id)
})

it('expires reviews and refuses source changes during asynchronous preparation', async () => {
  const f = sourceFixture(); let now = 0; let change = false
  const exporter = new PortableExporter(f.store, f.owner, '', async () => {
    if (change) new PodVariables(f.store).save(f.pod.id, 'new_field', 'new value', 0)
    return fixture()
  }, () => now)
  const review = await exporter.review(f.selection, {})
  now = review.expiresAt
  await expect(exporter.commit(review.id, [])).rejects.toThrow('review expired')
  change = true
  await expect(exporter.review(f.selection, {})).rejects.toThrow('source changed')
})

it('exports public values only after explicit default selection and leaves source state untouched', async () => {
  const f = sourceFixture()
  f.store.db.prepare('INSERT INTO schedules(pod_id,revision,spec,enabled,next_at,error) VALUES(?,1,?,1,123456,NULL)').run(f.pod.id, JSON.stringify({ kind: 'daily', time: '07:00', timezone: 'Europe/Vienna' }))
  new PodVariables(f.store).save(f.pod.id, 'label', 'PUBLIC_DEFAULT_CANARY', 0)
  const source = capturePortableSource(f.store, f.owner, f.selection); const choices = mappingChoices(source)
  const exporter = new PortableExporter(f.store, f.owner, '', (snapshot, options: PortableExportChoices) => mapPortableSource(f.store.root, snapshot, options))
  const review = await exporter.review(f.selection, choices)
  const initial = await exporter.commit(review.id, [])
  expect(initial.manifest.pods[0]!.schedule).toEqual({ kind: 'daily', time: '07:00', timezone: 'Europe/Vienna' })
  expect(initial.manifest.pods[0]!.schedule).not.toHaveProperty('enabled')
  expect(initial.manifest.pods[0]!.inputs[0]).not.toHaveProperty('default')
  choices.pods[0]!.defaults.push('variable:label')
  expect((await exporter.commit(review.id, [])).manifest.pods[0]!.inputs[0]).not.toHaveProperty('default')
  const content = await mapPortableSource(f.store.root, source, choices)
  const explicit = await createPortablePackage(content.description, content.payloads, '')
  expect(explicit.manifest.pods[0]!.inputs[0]!.default).toBe('PUBLIC_DEFAULT_CANARY')
  expect(capturePortableSource(f.store, f.owner, f.selection)).toEqual(source)
})

it('exports two application bindings as distinct recipient accounts without paths, state or environment values', async () => {
  const f = sourceFixture()
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pods-sharing-programs-'))); assetRoots.push(root)
  const executable = join(root, 'fixture'); const adapterPath = join(root, 'fixture.toml')
  writeFileSync(executable, '#!/bin/sh\nexit 77\n', { mode: 0o700 })
  writeFileSync(adapterPath, 'schema="openape-shapes/v1"\n[cli]\nid="fixture"\nexecutable="fixture"\nversion="1"\n[[operation]]\nid="read"\ncommand=["read"]\ndisplay="Read fixture"\naction="read"\nrisk="low"\nresource_chain=["fixture:*"]\n')
  const definition = await programDefinition(executable, adapterPath)
  const applicationIds = [randomUUID(), randomUUID()]; const stateIds = [randomUUID(), randomUUID()]
  for (const [index, id] of applicationIds.entries()) f.resources.assignProgram(f.pod.id, id, { ...definition, type: 'program', stateId: stateIds[index]!, capability: `tool.app_${id.replaceAll('-', '')}.invoke`, environment: { PROFILE: 'PRIVATE_ENV_CANARY' }, grants: [] }, f.resources.epoch(f.pod.id))
  installExample(f.store, f.resources, f.pod.id, 'deterministic', 'a'.repeat(64))
  const source = capturePortableSource(f.store, f.owner, f.selection); const choices = mappingChoices(source)
  choices.pods[0]!.aliases = applicationIds.map((resourceId, index) => ({ resourceId, alias: `account_${index + 1}` }))
  const content = await mapPortableSource(f.store.root, source, choices)
  const exported = await createPortablePackage(content.description, content.payloads, '')
  const pod = exported.manifest.pods[0]!
  expect(pod.applications).toHaveLength(2)
  expect(new Set(pod.applications.map(binding => binding.account)).size).toBe(2)
  expect(pod.inputs.filter(input => input.kind === 'account').map(input => input.sharingGroup)).toEqual([null, null])
  const serialized = Object.values(unzipSync(exported.archive)).map(file => Buffer.from(file).toString()).join('\n')
  for (const privateValue of [...applicationIds, ...stateIds, root, 'PRIVATE_ENV_CANARY']) expect(serialized).not.toContain(privateValue)
  expect(exported.manifest.applications.every(application => application.testedVersions.length === 0)).toBe(true)
})

it('retains collection names, retention, artifact association and explicit shared-input precedence', async () => {
  const f = networkFixture()
  const producer = f.pod('Producer', { takes: [], gives: ['work.ready'], summary: 'Produce' }, async () => {})
  const consumer = f.pod('Consumer', { takes: ['work.ready'], gives: [], summary: 'Consume' }, async () => {})
  const id = f.create([{ podId: producer, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }], ['work.ready'])
  for (const podId of [producer, consumer]) {
    const binding = f.store.db.prepare('SELECT definition_id FROM instance_definition_bindings WHERE pod_id=?').get(podId)!
    f.store.db.prepare('INSERT INTO definition_config VALUES(?,1,?,?,?)').run(binding.definition_id!, 'label', 'public', JSON.stringify('Base label'))
  }
  f.store.db.prepare('INSERT INTO composition_config VALUES(?,?,?)').run(id, 'label', JSON.stringify('Shared label'))
  f.store.db.prepare('INSERT INTO instance_config VALUES(?,?,?)').run(consumer, 'label', JSON.stringify('PRIVATE_INSTANCE_VALUE'))
  const collectionId = randomUUID(); const scopeId = randomUUID()
  f.store.transaction(() => {
    f.store.db.prepare('INSERT INTO data_collections VALUES(?,?,?,?,?,1,?)').run(collectionId, f.owner.issuer, f.owner.subject, f.groupId, 'invoices', JSON.stringify({ days: 30 }))
    f.store.db.prepare('INSERT INTO data_collection_versions VALUES(?,1,?,?,0)').run(collectionId, JSON.stringify({ type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false }), '[]')
    f.store.db.prepare('INSERT INTO data_permissions VALUES(?,?,?,?,?,?,?,1)').run(id, producer, collectionId, f.owner.issuer, f.owner.subject, f.groupId, 'read')
    f.store.db.prepare('INSERT INTO artifact_scopes VALUES(?,?,?,?,?,NULL)').run(scopeId, f.owner.issuer, f.owner.subject, f.groupId, collectionId)
    f.store.db.prepare('INSERT INTO artifact_permissions VALUES(?,?,?,?,?,?,?,1)').run(id, consumer, scopeId, f.owner.issuer, f.owner.subject, f.groupId, 'read')
    f.store.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,0)').run(randomUUID(), scopeId, 'b'.repeat(64), 0, 'text/plain', 'PRIVATE_ARTIFACT_CANARY')
  })
  const source = capturePortableSource(f.store, f.owner, { kind: 'network', id }); const choices = mappingChoices(source)
  expect(source.privateValues).toEqual(expect.arrayContaining(['Base label', 'Shared label', 'PRIVATE_INSTANCE_VALUE']))
  choices.compositions[0]!.defaults = ['value:label']
  const content = await mapPortableSource(f.store.root, source, choices)
  const exported = await createPortablePackage(content.description, content.payloads, '')
  const archive = unzipSync(exported.archive)
  const document = JSON.parse(Buffer.from(archive['compositions/composition_1.json']!).toString())
  expect(document.collections[0]).toMatchObject({ name: 'invoices', retention: { days: 30 }, access: [{ pod: 'pod_1', operations: ['read'] }] })
  expect(document.artifacts[0]).toMatchObject({ collection: document.collections[0].key, access: [{ pod: 'pod_2', operations: ['read'] }] })
  const shared = exported.manifest.compositions[0]!.inputs[0]!
  expect(shared.default).toBe('Shared label')
  expect(exported.manifest.pods[0]!.inputs[0]!.sharingGroup).toBe(shared.sharingGroup)
  expect(shared.sharingGroup).not.toBeNull()
  expect(exported.manifest.pods[1]!.inputs[0]!.sharingGroup).toBeNull()
  const serialized = Object.values(archive).map(file => Buffer.from(file).toString()).join('\n')
  for (const value of ['PRIVATE_INSTANCE_VALUE', 'PRIVATE_ARTIFACT_CANARY', collectionId, scopeId]) expect(serialized).not.toContain(value)
})

it('serializes preparation and still scans selected defaults inside payloads', async () => {
  const f = sourceFixture(); const value = 'REVIEW_PAYLOAD_DEFAULT_CANARY'
  new PodVariables(f.store).save(f.pod.id, 'label', value, 0)
  let resume!: () => void
  let pause = true
  const exporter = new PortableExporter(f.store, f.owner, '', async () => {
    if (pause) await new Promise<void>((resolve) => { resume = resolve })
    const content = fixture()
    content.description.pods[0]!.inputs.push({ key: 'label', label: 'Label', description: '', kind: 'string', required: true, sharingGroup: null, default: value })
    content.description.pods[0]!.bindings.push({ alias: 'label', input: 'label' })
    content.payloads[1]!.content = bytes(value)
    return content
  })
  const preparing = exporter.review(f.selection, {})
  await expect(exporter.review(f.selection, {})).rejects.toThrow('preparation is running')
  pause = false; resume()
  const review = await preparing
  expect(review.findings.map(finding => [finding.path, finding.kind])).toEqual([['assets/template.txt', 'private-value']])
  await expect(exporter.commit(review.id, [])).rejects.toThrow('Acknowledge each')
  await expect(exporter.commit(review.id, review.findings.map(finding => finding.id))).resolves.toHaveProperty('archive')
})

it('bounds repeated private-value findings without flagging substrings or generated metadata', () => {
  const content = bytes('node '.repeat(1000))
  expect(scanPortableFiles([{ path: 'pods/run.mjs', content, text: true }], [], ['node'])).toHaveLength(1)
  expect(scanPortableFiles([{ path: 'pods/run.mjs', content: bytes('nodes node_modules mynode'), text: true }], [], ['node'])).toEqual([])
  expect(scanPortableFiles([{ path: 'pods/package-lock.json', content, text: true, privateValues: false }], [], ['node'])).toEqual([])
})
