import { describe, expect, it } from 'vitest'
import { parsePortableManifest } from '@openape/pods-protocol'
import type { PortableComposition, PortableManifest } from '@openape/pods-protocol'
import { validatePortableAccessDefaults, validatePortableCollectionDocument, validatePortableCompositionDocument } from '../../src/contracts/portable-composition'

const schema = { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false }
function fixture(kind: PortableComposition['kind'] = 'sequence') {
  const pods = ['read', 'summarize', 'send'].map((key, index) => ({
    key, title: key, description: '', script: `pods/${key}.mjs`, packages: null,
    contract: { takes: index ? [`step.${index === 1 ? 'one' : 'two'}`] : [], gives: index < 2 ? [`step.${index === 0 ? 'one' : 'two'}`] : [], summary: key },
    access: [], requestedCapabilities: [], inputs: [], bindings: [], applications: [], assets: [],
  }))
  const manifest = parsePortableManifest({
    format: 'openape-package', version: 1, package: { key: 'fixture', revision: 1, title: 'Fixture', description: '' }, requiredFeatures: ['portable_aliases_v1'],
    entry: { kind, key: 'briefing' }, pods, applications: [],
    compositions: [{ key: 'briefing', kind, title: 'Briefing', document: 'composition.json', documentVersion: 1, nodes: pods.map((pod, index) => ({ pod: pod.key, after: kind === 'sequence' && index ? [pods[index - 1]!.key] : [], handoff: kind === 'sequence' && index > 0 })), calls: [], inputs: [], dataSchemas: [] }],
    files: [...pods.map(pod => ({ path: pod.script, kind: 'script', bytes: 100, sha256: 'a'.repeat(64), mediaType: 'text/javascript' })), { path: 'composition.json', kind: 'composition', bytes: 200, sha256: 'a'.repeat(64), mediaType: 'application/json' }], contentSha256: 'a'.repeat(64),
  }, ['portable_aliases_v1'])
  return { manifest, composition: manifest.compositions[0]! }
}
function document(kind: PortableComposition['kind']) {
  if (kind === 'sequence') return { version: 1, kind, schedule: null, ports: null, mail: null }
  const channels = [1, 2].map(index => ({ name: `step.${index === 1 ? 'one' : 'two'}`, title: `Step ${index}`, ...(kind === 'network' ? { schemaVersion: 1, schema } : { fields: ['subject'] }) }))
  if (kind === 'channels') return { version: 1, kind, schedule: null, channels, gates: [], values: [], ports: null }
  return { version: 1, kind, formatVersion: 3, channels, members: ['read', 'summarize', 'send'].map((pod, index) => ({ pod, source: index ? null : { schedule: null }, serialCase: true })), gates: [], joins: [], values: [], collections: [], artifacts: [], calls: [] }
}
function validate(value: unknown, fixture: { manifest: PortableManifest, composition: PortableComposition }) {
  return validatePortableCompositionDocument(value, fixture.composition, fixture.manifest)
}
function portDeclaration() {
  return { version: 1, inputs: [{ name: 'in', version: 1, schema, pod: 'read' }], outputs: [{ name: 'out', version: 1, schema, pod: 'send' }], requiredTerminals: ['send'], requiredGates: [] }
}

describe('portable composition documents', () => {
  it.each(['sequence', 'channels', 'network'] as const)('validates %s with native contracts while retaining only aliases', (kind) => {
    const source = document(kind)
    expect(validate(source, fixture(kind))).toEqual(source)
    expect(JSON.stringify(validate(source, fixture(kind)))).not.toContain('00000000-0000')
    expect(() => validate({ ...source, enabled: true }, fixture(kind))).toThrow('fields')
    expect(() => validate({ ...source, version: 2 }, fixture(kind))).toThrow('version')
  })

  it.each(['sequence', 'channels'] as const)('validates %s input and terminal ports against actual topology', (kind) => {
    const source = { ...document(kind), ports: portDeclaration() }
    expect(() => validate(source, fixture(kind))).not.toThrow()
    source.ports.inputs[0]!.pod = 'summarize'
    expect(() => validate(source, fixture(kind))).toThrow('entry nodes')
    source.ports.inputs[0]!.pod = 'read'; source.ports.requiredTerminals = ['summarize']; source.ports.outputs[0]!.pod = 'summarize'
    expect(() => validate(source, fixture(kind))).toThrow('successors')
  })

  it('rejects undeclared channels and missing native contracts', () => {
    const value = fixture('channels'); value.manifest.pods[1]!.contract!.takes = ['missing']
    expect(() => validate(document('channels'), value)).toThrow('channel-undeclared')
    value.manifest.pods[1]!.contract = null
    expect(() => validate(document('channels'), value)).toThrow('contract-missing')
  })

  it('refuses source state, unsupported capabilities and missing network members', () => {
    const source = document('network') as ReturnType<typeof document> & { members: { pod: string, source: unknown }[] }
    Object.assign(source.members[0]!.source!, { cursor: 'sender-checkpoint' })
    expect(() => validate(source, fixture('network'))).toThrow('fields')
    const value = fixture('network'); value.manifest.pods[0]!.requestedCapabilities = ['tool.mail.invoke']
    expect(() => validate(document('network'), value)).toThrow('unsupported runtime capabilities')
    const missing = { ...document('network'), members: [] }
    expect(() => validate(missing, fixture('network'))).toThrow('membership')
  })

  it('requires public value inputs and explicitly scoped data requests', () => {
    const value = fixture('network')
    value.composition.inputs.push({ key: 'token', label: 'Token', description: '', kind: 'secret', required: true, sharingGroup: null })
    expect(() => validate({ ...document('network'), values: [{ name: 'token', input: 'token' }] }, value)).toThrow('public input')
    value.composition.inputs = []
    value.composition.dataSchemas = ['schemas/items.json']
    const collection = { key: 'items', schema: 'schemas/items.json', access: [{ pod: 'read', operations: ['read', 'write'] }] }
    expect(() => validate({ ...document('network'), collections: [collection] }, value)).not.toThrow()
    collection.access[0]!.operations = ['admin']
    expect(() => validate({ ...document('network'), collections: [collection] }, value)).toThrow('data operation')
    expect(() => validate(document('network'), value)).toThrow('Unreferenced')
  })

  it('validates collection schemas and indexes without importing records or authority', () => {
    const source = { version: 1, schema, indexes: [{ name: 'subject', field: 'subject' }] }
    expect(validatePortableCollectionDocument(source)).toEqual({ schema, indexes: source.indexes })
    expect(() => validatePortableCollectionDocument({ ...source, records: [] })).toThrow('fields')
    expect(() => validatePortableCollectionDocument({ ...source, indexes: [{ name: 'missing', field: 'missing' }] })).toThrow('declared scalar')
  })
})

it('rejects graph values that shadow recipient variable aliases', () => {
  const value = fixture('channels')
  const input = { key: 'subject', label: 'Subject', description: '', kind: 'string' as const, required: true, sharingGroup: null }
  value.composition.inputs = [input]; value.manifest.pods[0]!.inputs = [input]; value.manifest.pods[0]!.bindings = [{ alias: 'subject', input: 'subject' }]
  expect(() => validate({ ...document('channels'), values: [{ name: 'subject', input: 'subject' }] }, value)).toThrow('value-name-conflict')
})

it('requires mail notification ancestry and a real recipient credential alias', () => {
  const value = fixture()
  value.manifest.pods[0]!.applications = [{ alias: 'mail', requirement: 'fixture', account: 'account', environment: [] }]
  value.manifest.pods[2]!.inputs = [{ key: 'token', label: 'Token', description: '', kind: 'secret', required: true, sharingGroup: null }]
  value.manifest.pods[2]!.bindings = [{ alias: 'telegram', input: 'token' }]
  value.composition.inputs = ['mailbox', 'chat', 'partners', 'rules'].map(key => ({ key, label: key, description: '', kind: 'string', required: true, sharingGroup: null }))
  const mail = { filter: 'read', notify: 'send', application: 'mail', mailbox: 'mailbox', telegramCredential: 'telegram', telegramChat: 'chat', protectedPartners: 'partners', rules: 'rules', mode: 'preview' }
  expect(() => validate({ ...document('sequence'), mail }, value)).not.toThrow()
  mail.telegramCredential = 'token'
  expect(() => validate({ ...document('sequence'), mail }, value)).toThrow('recipient secret')
  mail.telegramCredential = 'telegram'; value.composition.nodes[2]!.after = []; value.composition.nodes[2]!.handoff = false
  expect(() => validate({ ...document('sequence'), mail }, value)).toThrow('must depend')
})

it('validates explicitly suggested HTTP origins and AI models with native parsers', () => {
  const pod = fixture().manifest.pods[0]!
  pod.inputs = ['origin', 'model'].map(key => ({ key, label: key, description: '', kind: 'string', required: true, sharingGroup: null }))
  pod.access = [{ kind: 'http', alias: 'api', origin: 'origin', methods: ['GET'], authentication: null }, { kind: 'jev', alias: 'decision', connection: 'connection', model: 'model', maxAttempts: 1 }]
  pod.inputs[0]!.default = 'https://api.example.com'; pod.inputs[1]!.default = 'jev-1.13.0'
  expect(() => validatePortableAccessDefaults(pod)).not.toThrow()
  pod.inputs[0]!.default = 'http://localhost'
  expect(() => validatePortableAccessDefaults(pod)).toThrow('public HTTPS')
  pod.inputs[0]!.default = 'https://api.example.com'; pod.inputs[1]!.default = 'latest'
  expect(() => validatePortableAccessDefaults(pod)).toThrow('pinned Jev')
})

it('requires network overrides to match declared public fields instead of treating them as graph variables', () => {
  const value = fixture('network')
  const input = { key: 'count', label: 'Count', description: '', kind: 'number' as const, required: true, sharingGroup: null }
  value.composition.inputs = [input]
  const source = { ...document('network'), values: [{ name: 'count', input: 'count' }] }
  expect(() => validate(source, value)).toThrow('declared public field')
  value.manifest.pods[0]!.inputs = [input]; value.manifest.pods[0]!.bindings = [{ alias: 'count', input: 'count' }]
  expect(() => validate(source, value)).not.toThrow()
  value.manifest.pods[0]!.inputs = [{ ...input, kind: 'string' }]
  expect(() => validate(source, value)).toThrow('types must match')
})
