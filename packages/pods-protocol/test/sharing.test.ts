import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assertPortableCompatibility, canonicalPortableJson, parsePortableManifest as parseManifest, portableContentBytes, portablePath, sharingLimits } from '../src/sharing'
import type { PortableManifest, PortablePod } from '../src/sharing'

function parsePortableManifest(value: unknown) { return parseManifest(value, ['portable_aliases_v1']) }

function fixture(): PortableManifest {
  const hash = 'a'.repeat(64)
  const pods: PortablePod[] = ['read', 'summarize', 'send'].map((key, index) => ({
    key, title: key, description: 'Synthetic portable fixture', script: `pods/${key}.mjs`, packages: null,
    contract: { takes: index ? [`step.${index === 1 ? 'one' : 'two'}`] : [], gives: index === 2 ? [] : [`step.${index === 0 ? 'one' : 'two'}`], summary: key },
    access: [], requestedCapabilities: ['tool.mail.invoke'],
    inputs: [
      { key: 'account', label: 'Account', description: 'Separate recipient account', kind: 'account', required: true, sharingGroup: null },
      { key: 'count', label: 'Count', description: '', kind: 'number', required: true, minimum: 1, maximum: 10, default: 3, sharingGroup: null },
      { key: 'destination', label: 'Destination', description: '', kind: 'string', required: true, sharingGroup: null },
    ],
    bindings: [{ alias: 'destination', input: 'destination' }, { alias: 'count', input: 'count' }],
    applications: [{ alias: 'mail', requirement: index === 2 ? 'missing_app' : 'mail_app', account: 'account', environment: [] }],
    assets: index === 1 ? ['assets/template.txt'] : [],
  }))
  return {
    format: 'openape-package', version: 1, package: { key: 'morning_briefing', revision: 1, title: 'Morning briefing', description: 'Synthetic only' }, requiredFeatures: ['portable_aliases_v1'],
    entry: { kind: 'sequence', key: 'briefing' }, pods,
    compositions: [{ key: 'briefing', kind: 'sequence', title: 'Briefing', document: 'compositions/briefing.json', documentVersion: 1, nodes: pods.map((pod, index) => ({ pod: pod.key, after: index ? [pods[index - 1]!.key] : [], handoff: index > 0 })), calls: [], inputs: [], dataSchemas: [] }],
    applications: ['mail_app', 'missing_app'].map(key => ({ key, application: `org.example.${key.replaceAll('_', '-')}`, adapter: { identity: 'org.example.fixture', version: 1, operations: ['invoke'] }, testedVersions: ['1.0.0'], platforms: [{ os: 'darwin', architecture: 'arm64' }], distribution: null, instructions: 'Select the compatible fixture application on the recipient desktop.' })),
    files: [
      ...pods.map(pod => ({ path: pod.script, kind: 'script' as const, bytes: 100, sha256: hash, mediaType: 'text/javascript' })),
      { path: 'assets/template.txt', kind: 'asset', bytes: 40, sha256: hash, mediaType: 'text/plain' },
      { path: 'compositions/briefing.json', kind: 'composition', bytes: 200, sha256: hash, mediaType: 'application/json' },
    ], contentSha256: hash,
  }
}

describe('portable package boundary', () => {
  it('preserves three-Pod topology, typed declarations and distinct account roles without authority', () => {
    const manifest = parsePortableManifest(fixture())
    expect(manifest.compositions[0]!.nodes).toEqual([{ pod: 'read', after: [], handoff: false }, { pod: 'summarize', after: ['read'], handoff: true }, { pod: 'send', after: ['summarize'], handoff: true }])
    expect(manifest.pods[0]!.applications[0]!.requirement).toBe(manifest.pods[1]!.applications[0]!.requirement)
    expect(manifest.pods.slice(0, 2).map(pod => pod.inputs[0]!.sharingGroup)).toEqual([null, null])
    expect(manifest.pods[2]!.requestedCapabilities).toContain('tool.mail.invoke')
    expect(manifest.pods[1]!.assets).toEqual(['assets/template.txt'])
  })

  it('accepts a single Pod without a composition or application account values', () => {
    const manifest = fixture(); const pod = manifest.pods[0]!
    manifest.applications = [manifest.applications[0]!]; manifest.entry = { kind: 'pod', key: pod.key }; manifest.pods = [pod]; manifest.compositions = []; manifest.files = manifest.files.filter(file => file.path === pod.script)
    expect(parsePortableManifest(manifest).entry.kind).toBe('pod')
    expect(() => parsePortableManifest({ ...manifest, owner: 'sender@example.invalid' })).toThrow('fields')
    expect(() => parsePortableManifest({ ...manifest, version: 2 })).toThrow('version')
  })

  it.each(['__proto__', 'assets/constructor', 'Prototype', '../escape', '/absolute', 'a/../b', 'a//b', 'a\\b', 'C:/path', 'a/%2e%2e/b', 'con.txt', 'folder/nul', 'a/.', 'a/b.'])('rejects nonportable file path %s', (path) => {
    expect(() => portablePath(path)).toThrow()
  })

  it('rejects dangling references, cycles, duplicate Pods and invented sequence edges on networks', () => {
    for (const change of [
      (manifest: PortableManifest) => { manifest.compositions[0]!.nodes[1]!.after = ['missing'] },
      (manifest: PortableManifest) => { manifest.compositions[0]!.nodes[0]!.after = ['send'] },
      (manifest: PortableManifest) => { manifest.pods[1]!.key = manifest.pods[0]!.key },
      (manifest: PortableManifest) => { manifest.compositions[0]!.kind = 'network'; manifest.entry.kind = 'network' },
      (manifest: PortableManifest) => { manifest.pods[0]!.script = 'missing.mjs' },
      (manifest: PortableManifest) => { manifest.pods[0]!.applications[0]!.account = 'destination' },
      (manifest: PortableManifest) => { manifest.compositions[0]!.calls = ['absent'] },
    ]) { const manifest = fixture(); change(manifest); expect(() => parsePortableManifest(manifest)).toThrow() }
  })

  it('never interprets imported access, executable paths or secret values as authority', () => {
    for (const extra of [{ grants: [] }, { executable: '/Applications/Mail.app' }, { stateId: 'local-state' }, { environment: { TOKEN: 'private' } }]) {
      const manifest = fixture(); Object.assign(manifest.applications[0]!, extra)
      expect(() => parsePortableManifest(manifest)).toThrow('fields')
    }
    for (const kind of ['account', 'secret', 'directory', 'connection'] as const) {
      const manifest = fixture(); manifest.pods[0]!.inputs[0] = { ...manifest.pods[0]!.inputs[0]!, kind, default: 'private' }
      expect(() => parsePortableManifest(manifest)).toThrow('cannot have defaults')
    }
  })

  it('requires explicit compatible sharing groups and validates defaults', () => {
    const manifest = fixture(); manifest.pods[0]!.inputs[1]!.sharingGroup = 'count'; manifest.pods[1]!.inputs[1]!.sharingGroup = 'count'
    expect(() => parsePortableManifest(manifest)).not.toThrow()
    manifest.pods[1]!.inputs[1]!.default = 4
    expect(() => parsePortableManifest(manifest)).toThrow('incompatible shared')
    manifest.pods[1]!.inputs[1]!.sharingGroup = null; manifest.pods[1]!.inputs[1]!.default = 11
    expect(() => parsePortableManifest(manifest)).toThrow('numeric default')
  })

  it('bounds files and expansion and rejects case collisions and unreferenced files', () => {
    const manifest = fixture()
    manifest.files[0]!.bytes = sharingLimits.expandedBytes
    expect(() => parsePortableManifest(manifest)).toThrow('role limit')
    manifest.files[0]!.bytes = 100
    manifest.files.push({ ...manifest.files[0]!, path: manifest.files[0]!.path.toUpperCase() })
    expect(() => parsePortableManifest(manifest)).toThrow('duplicate')
    manifest.files.at(-1)!.path = 'history.json'
    expect(() => parsePortableManifest(manifest)).toThrow('unreferenced')
  })

  it('canonicalizes file metadata order and excludes only the content digest itself', () => {
    const manifest = fixture(); const original = createHash('sha256').update(portableContentBytes(manifest, ['portable_aliases_v1'])).digest('hex')
    manifest.files.reverse(); manifest.contentSha256 = 'b'.repeat(64)
    expect(createHash('sha256').update(portableContentBytes(manifest, ['portable_aliases_v1'])).digest('hex')).toBe(original)
    manifest.files[0]!.sha256 = 'c'.repeat(64)
    expect(createHash('sha256').update(portableContentBytes(manifest, ['portable_aliases_v1'])).digest('hex')).not.toBe(original)
  })

  it('rejects ordinary accessors and sparse arrays without calling getters', () => {
    let accessed = false
    const value = Object.defineProperty({}, 'danger', { enumerable: true, get() { accessed = true; return 'secret' } })
    expect(() => canonicalPortableJson(value)).toThrow('plain JSON')
    expect(accessed).toBe(false)
    expect(() => canonicalPortableJson(Array.from({ length: 2 }, () => undefined))).toThrow('finite JSON')
    const sparse: unknown[] = []; sparse.length = 2
    expect(() => canonicalPortableJson(sparse)).toThrow('dense array')
    expect(() => canonicalPortableJson({ number: Number.NaN })).toThrow()
  })
})

it('refuses unsupported runtime features and source-bound capability identities', () => {
  const manifest = fixture()
  expect(() => assertPortableCompatibility(manifest, [])).toThrow('runtime does not support')
  expect(() => assertPortableCompatibility(manifest, ['portable_aliases_v1'])).not.toThrow()
  manifest.pods[0]!.requestedCapabilities = ['tool.app_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.read']
  expect(() => parsePortableManifest(manifest)).toThrow('source-bound identity')
})

it('rejects enum type confusion, hidden account reuse and incompatible explicit account groups', () => {
  const confused = fixture(); Object.assign(confused.pods[0]!.inputs[0]!, { kind: ['secret'] })
  expect(() => parsePortableManifest(confused)).toThrow('enum value')
  const duplicated = fixture(); duplicated.pods[0]!.applications.push({ ...duplicated.pods[0]!.applications[0]!, alias: 'other' })
  expect(() => parsePortableManifest(duplicated)).toThrow('duplicate')
  const shared = fixture(); shared.pods[0]!.inputs[0]!.sharingGroup = 'account'; shared.pods[2]!.inputs[0]!.sharingGroup = 'account'
  expect(() => parsePortableManifest(shared)).toThrow('same application')
  shared.pods[2]!.inputs[0]!.sharingGroup = null; shared.pods[1]!.inputs[0]!.sharingGroup = 'account'
  expect(() => parsePortableManifest(shared)).not.toThrow()
  shared.pods[0]!.applications[0]!.environment = [{ alias: 'LOCALE', input: 'account' }]
  expect(() => parsePortableManifest(shared)).toThrow('environment input')
})

it('checks version and required runtime features before accepting the package', () => {
  expect(() => parseManifest({ ...fixture(), version: 2, futureField: true }, [])).toThrow('unsupported package version')
  expect(() => parseManifest(fixture(), [])).toThrow('runtime does not support')
  expect(() => parseManifest({ ...fixture(), requiredFeatures: [] }, [])).toThrow('alias feature is required')
})

it('bounds aggregate expansion and canonical traversal and rejects file-directory collisions', () => {
  const manifest = fixture()
  for (let index = 0; index < 4; index++) {
    const path = `assets/large-${index}.txt`
    manifest.files.push({ path, kind: 'asset', bytes: 32 * 1024 * 1024, sha256: 'a'.repeat(64), mediaType: 'text/plain' })
    manifest.pods[0]!.assets.push(path)
  }
  expect(() => parsePortableManifest(manifest)).toThrow('100 MiB')
  const collision = fixture(); collision.files.push({ ...collision.files[0]!, path: 'pods' })
  expect(() => parsePortableManifest(collision)).toThrow('paths collide')
  let repeated: unknown = 'fixture'
  for (let index = 0; index < 20; index++) repeated = [repeated, repeated]
  expect(() => canonicalPortableJson(repeated)).toThrow('node budget')
})

it('carries requested file, HTTP and AI scope through typed recipient inputs only', () => {
  const manifest = fixture(); const pod = manifest.pods[0]!
  for (const [key, kind] of [['folder', 'directory'], ['origin', 'string'], ['subject', 'string'], ['issuer', 'string'], ['identity', 'secret'], ['ai', 'connection'], ['model', 'string']] as const) {
    pod.inputs.push({ key, kind, label: key, description: '', required: true, sharingGroup: null })
  }
  pod.bindings.push({ alias: 'api_identity', input: 'identity' })
  pod.access = [
    { kind: 'directory', alias: 'files', input: 'folder', access: 'readWrite' },
    { kind: 'http', alias: 'api', origin: 'origin', methods: ['GET', 'POST'], authentication: { type: 'ddisaAgent', credential: 'api_identity', subject: 'subject', issuer: 'issuer' } },
    { kind: 'jev', alias: 'decision', connection: 'ai', model: 'model', maxAttempts: 2 },
  ]
  expect(parsePortableManifest(manifest).pods[0]!.access).toEqual(pod.access)
  for (const key of ['folder', 'identity', 'ai', 'subject', 'origin', 'issuer', 'model']) {
    const input = pod.inputs.find(input => input.key === key)!
    input.sharingGroup = 'shared'
    expect(() => parsePortableManifest(manifest)).toThrow(['subject', 'origin', 'issuer', 'model'].includes(key) ? 'independent recipient choices' : 'cannot be shared')
    input.sharingGroup = null
  }
  const http = pod.access[1]!
  if (http.kind !== 'http' || !http.authentication) throw new Error('Missing fixture authentication')
  http.authentication.issuer = 'origin'
  expect(() => parsePortableManifest(manifest)).toThrow('duplicate')
  http.authentication.issuer = 'issuer'
  pod.inputs.push({ key: 'wrong_folder', kind: 'string', label: 'Wrong folder', description: '', required: true, sharingGroup: null })
  pod.access[0] = { kind: 'directory', alias: 'files', input: 'wrong_folder', access: 'read' }
  expect(() => parsePortableManifest(manifest)).toThrow('mistyped access input')
  pod.access[0] = { kind: 'http', alias: 'api', origin: 'origin', methods: ['GET'], authentication: null }
  expect(() => parsePortableManifest(manifest)).toThrow('duplicate')
  pod.access = [{ kind: 'http', alias: 'api', origin: 'https://sender.example.invalid', methods: ['GET'], authentication: null }]
  expect(() => parsePortableManifest(manifest)).toThrow('local key')
})

it('refuses injected environment settings and undeclared capability bindings', () => {
  for (const alias of ['NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'HOME', 'API_TOKEN', 'lowercase']) {
    const manifest = fixture(); manifest.pods[0]!.applications[0]!.environment = [{ alias, input: 'destination' }]
    expect(() => parsePortableManifest(manifest)).toThrow('environment variable name')
  }
  const manifest = fixture(); manifest.pods[0]!.applications[0]!.environment = [{ alias: 'LOCALE', input: 'destination' }]
  manifest.pods[0]!.inputs[2]!.default = 'en\nmalformed'
  expect(() => parsePortableManifest(manifest)).toThrow('plain lines')
  delete manifest.pods[0]!.inputs[2]!.default
  manifest.pods[0]!.inputs[2]!.kind = 'secret'
  expect(() => parsePortableManifest(manifest)).toThrow('environment input')
  for (const capability of ['tool.unknown.send', 'tool.mail.unknown', 'credential.unknown', 'jev.evaluate']) {
    const manifest = fixture(); manifest.pods[0]!.requestedCapabilities = [capability]
    expect(() => parsePortableManifest(manifest)).toThrow('undeclared')
  }
})

it('rejects tooling paths and nonportable composition metadata', () => {
  for (const path of ['.npmrc', '.git/config', 'node_modules/a.js', 'assets/-option']) expect(() => portablePath(path)).toThrow('unsupported file path')
  const manifest = fixture(); manifest.compositions[0]!.title = 'x'.repeat(101)
  expect(() => parsePortableManifest(manifest)).toThrow('invalid text')
  manifest.compositions[0]!.title = 'Fixture'; manifest.compositions[0]!.inputs = [manifest.pods[0]!.inputs[0]!]
  expect(() => parsePortableManifest(manifest)).toThrow('public values')
})

it('refuses scope-free resource bindings and declares recipient mail scope explicitly', () => {
  const manifest = fixture(); const pod = manifest.pods[0]!
  pod.inputs.push({ key: 'folder', label: 'Folder', description: '', kind: 'directory', required: true, sharingGroup: null })
  pod.bindings.push({ alias: 'folder', input: 'folder' })
  expect(() => parsePortableManifest(manifest)).toThrow('invalid input binding')
  pod.inputs.pop(); pod.bindings.pop()
  for (const [key, kind] of [['mail_connection', 'connection'], ['folders', 'string'], ['since', 'string']] as const) pod.inputs.push({ key, kind, label: key, description: '', required: true, sharingGroup: null })
  pod.requestedCapabilities.push('mail.read')
  expect(() => parsePortableManifest(manifest)).toThrow('undeclared mail access')
  pod.access = [{ kind: 'mail', alias: 'inbox', connection: 'mail_connection', folders: 'folders', since: 'since', attachments: false }]
  expect(() => parsePortableManifest(manifest)).not.toThrow()
  pod.inputs.find(input => input.key === 'folders')!.default = '["sender-folder-id"]'
  expect(() => parsePortableManifest(manifest)).toThrow('recipient selection')
})

it('refuses competing standalone schedules on composition members', () => {
  const manifest = fixture()
  manifest.pods[0]!.schedule = { kind: 'interval', seconds: 60 }
  expect(() => parsePortableManifest(manifest)).toThrow('standalone schedules')
})
