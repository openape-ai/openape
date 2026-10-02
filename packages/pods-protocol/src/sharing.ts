export const sharingLimits = { transferBytes: 25 * 1024 * 1024, expandedBytes: 100 * 1024 * 1024, manifestBytes: 1024 * 1024, files: 500, pods: 32, inputs: 32, channels: 32, gates: 8, values: 32, valueCharacters: 16384 } as const
export const portableFileLimits = { script: 800000, 'package-manifest': 16384, 'package-lock': 1024 * 1024, asset: 32 * 1024 * 1024, composition: 1024 * 1024, 'data-schema': 16384 } as const
export type PortableKind = 'pod' | 'sequence' | 'channels' | 'network'
export type PortableFileKind = 'script' | 'package-manifest' | 'package-lock' | 'asset' | 'composition' | 'data-schema'
export interface PortableFile { path: string, kind: PortableFileKind, bytes: number, sha256: string, mediaType: string }
export type PortableInputKind = 'string' | 'number' | 'boolean' | 'enum' | 'directory' | 'account' | 'connection' | 'secret'
export interface PortableInput { key: string, label: string, description: string, kind: PortableInputKind, required: boolean, sharingGroup: string | null, default?: string | number | boolean, choices?: string[], minimum?: number, maximum?: number }
export interface PortableApplication {
  key: string
  application: string
  adapter: { identity: string, version: number, operations: string[] }
  testedVersions: string[]
  platforms: { os: 'darwin' | 'linux' | 'win32', architecture: 'arm64' | 'x64' }[]
  distribution: { kind: 'official-url', url: string } | null
  instructions: string
}
export interface PortableBinding { alias: string, input: string }
export interface PortableApplicationBinding { alias: string, requirement: string, account: string, environment: PortableBinding[] }
export interface PortableHttpAuthentication { type: 'ddisaAgent', credential: string, subject: string, issuer: string }
export type PortableSchedule = { kind: 'interval', seconds: number } | { kind: 'daily', time: string, timezone: string }
export type PortableAccess =
  | { kind: 'directory', alias: string, input: string, access: 'read' | 'readWrite' }
  | { kind: 'http', alias: string, origin: string, methods: string[], authentication: PortableHttpAuthentication | null }
  | { kind: 'mail', alias: string, connection: string, folders: string, since: string, attachments: boolean }
  | { kind: 'jev', alias: string, connection: string, model: string, maxAttempts: number }
export interface PortablePod {
  key: string
  title: string
  description: string
  script: string
  packages: { manifest: string, lock: string } | null
  contract: { takes: string[], gives: string[], summary: string } | null
  requestedCapabilities: string[]
  access: PortableAccess[]
  inputs: PortableInput[]
  bindings: PortableBinding[]
  applications: PortableApplicationBinding[]
  assets: string[]
  schedule?: PortableSchedule | null
}
export interface PortableNode { pod: string, after: string[], handoff: boolean }
export interface PortableComposition {
  key: string
  kind: Exclude<PortableKind, 'pod'>
  title: string
  document: string
  documentVersion: 1
  nodes: PortableNode[]
  calls: string[]
  inputs: PortableInput[]
  dataSchemas: string[]
}
export interface PortableManifest {
  format: 'openape-package'
  version: 1
  package: { key: string, revision: number, title: string, description: string }
  requiredFeatures: string[]
  entry: { kind: PortableKind, key: string }
  pods: PortablePod[]
  compositions: PortableComposition[]
  applications: PortableApplication[]
  files: PortableFile[]
  contentSha256: string
}

function fail(message: string): never { throw new Error(`Portable package: ${message}`) }
function fields(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected an object')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => !required.includes(key) && !optional.includes(key)) || required.some(key => !Object.hasOwn(result, key))) fail('unsupported or missing fields')
  return result
}
function text(value: unknown, limit: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > limit || value.includes('\0') || /[\uD800-\uDFFF]/u.test(value)) fail('invalid text')
  return value
}
function oneOf(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== 'string' || !allowed.includes(value)) fail('unsupported enum value')
  return value
}
function lineText(value: unknown, limit: number): string {
  const result = text(value, limit)
  if (/[\p{Cc}\u202A-\u202E\u2066-\u2069]/u.test(result)) fail('display text must be a plain line')
  return result
}
function sourceIdentity(value: string): boolean { return /[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i.test(value) }
function key(value: unknown): string {
  const result = text(value, 64)
  if (!/^[a-z][a-z0-9_-]*$/.test(result) || ['__proto__', 'constructor', 'prototype'].includes(result) || sourceIdentity(result)) fail('invalid local key')
  return result
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail('invalid integer or limit exceeded')
  return Number(value)
}
function list<T>(value: unknown, maximum: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > maximum) fail('list limit exceeded')
  return value.map(parse)
}
function unique(values: string[]): void { if (new Set(values).size !== values.length) fail('duplicate keys') }
function names(value: unknown, maximum = 32): string[] { const result = list(value, maximum, key); unique(result); return result }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') fail('invalid boolean'); return value }
function hash(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('invalid SHA256'); return value }

export function portablePath(value: unknown): string {
  const path = text(value, 240)
  if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(path)) fail('file path must be relative and normalized')
  for (const part of path.split('/')) {
    if (/^[.-]/.test(part) || ['node_modules', '__proto__', 'constructor', 'prototype'].includes(part.toLowerCase()) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(part)) fail('unsupported file path')
  }
  return path
}

function jsonData(value: unknown, depth = 0, budget = { nodes: 0, characters: 0 }): unknown {
  if (++budget.nodes > 100000) fail('JSON node budget exceeded')
  budget.characters += typeof value === 'string' ? value.length : 1
  if (budget.characters > sharingLimits.manifestBytes) fail('manifest exceeds 1 MiB')
  if (depth > 32) fail('JSON nesting limit exceeded')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return text(value, sharingLimits.manifestBytes, true)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!value || typeof value !== 'object') fail('expected finite JSON data')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Object.getOwnPropertySymbols(value).length) fail('expected plain JSON data')
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 10000 || Object.keys(descriptors).length !== value.length + 1) fail('expected a bounded dense array')
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = descriptors[String(index)]
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('expected plain JSON data')
      return jsonData(descriptor.value, depth + 1, budget)
    })
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('expected a plain object')
  return Object.fromEntries(Object.keys(descriptors).sort().map((name) => {
    const descriptor = descriptors[name]!
    if (['__proto__', 'constructor', 'prototype'].includes(name) || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('expected plain JSON fields')
    budget.characters += name.length
    return [name, jsonData(descriptor.value, depth + 1, budget)]
  }))
}

export function canonicalPortableJson(value: unknown): string {
  const encoded = JSON.stringify(jsonData(value))
  if (new TextEncoder().encode(encoded).length > sharingLimits.manifestBytes) fail('manifest exceeds 1 MiB')
  return encoded
}

function input(value: unknown, valueLimit: number): PortableInput {
  const item = fields(value, ['key', 'label', 'description', 'kind', 'required', 'sharingGroup'], ['default', 'choices', 'minimum', 'maximum'])
  key(item.key); lineText(item.label, 120); text(item.description, 2000, true); boolean(item.required)
  if (item.sharingGroup !== null) key(item.sharingGroup)
  oneOf(item.kind, ['string', 'number', 'boolean', 'enum', 'directory', 'account', 'connection', 'secret'])
  if (item.sharingGroup !== null && !['string', 'number', 'boolean', 'enum', 'account'].includes(String(item.kind))) fail('resource and secret inputs cannot be shared')
  if (item.kind === 'enum') { const choices = list(item.choices, 64, value => text(value, valueLimit)); if (!choices.length) fail('enum needs choices'); unique(choices) }
  else if (item.choices !== undefined) {
    fail('only enum inputs have choices')
  }
  for (const bound of ['minimum', 'maximum']) {
    if (item[bound] !== undefined && (item.kind !== 'number' || typeof item[bound] !== 'number' || !Number.isFinite(item[bound]))) fail('invalid number range')
  }
  if (item.minimum !== undefined && item.maximum !== undefined && Number(item.minimum) > Number(item.maximum)) fail('invalid number range')
  if (Object.hasOwn(item, 'default')) {
    if (item.kind === 'string' || item.kind === 'enum') {
      text(item.default, valueLimit, true)
    }
    else if (item.kind === 'number') { if (typeof item.default !== 'number' || !Number.isFinite(item.default) || (item.minimum !== undefined && item.default < Number(item.minimum)) || (item.maximum !== undefined && item.default > Number(item.maximum))) fail('invalid numeric default') }
    else if (item.kind === 'boolean') {
      boolean(item.default)
    }
    else {
      fail('resource and secret inputs cannot have defaults')
    }
    if (item.kind === 'enum' && !(item.choices as string[]).includes(item.default as string)) fail('default is not an enum choice')
  }
  return item as unknown as PortableInput
}
function inputs(value: unknown, valueLimit = 2048): PortableInput[] { const result = list(value, sharingLimits.inputs, item => input(item, valueLimit)); unique(result.map(item => item.key)); return result }
function bindings(value: unknown, environment = false): PortableBinding[] {
  const result = list(value, environment ? 16 : 32, (value) => { const item = fields(value, ['alias', 'input']); const alias = environment ? lineText(item.alias, 64) : key(item.alias); if (environment && (!/^[A-Z][A-Z0-9_]{0,63}$/.test(alias) || /HOME|PATH|TMP|PROXY|TOKEN|SECRET|PASSWORD|CREDENTIAL|SESSION|_PAT|AUTH|KEY|ELECTRON|DYLD|LD_|NODE_OPTIONS|AZURE_CONFIG_DIR/.test(alias))) fail('unsupported environment variable name'); return { alias, input: key(item.input) } })
  unique(result.map(item => item.alias)); return result
}
function channel(value: unknown): string { const name = text(value, 64); if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){0,4}$/.test(name)) fail('invalid channel name'); return name }
function access(value: unknown): PortableAccess {
  const kind = fields(value, ['kind', 'alias'], ['input', 'access', 'origin', 'methods', 'authentication', 'connection', 'model', 'maxAttempts', 'folders', 'since', 'attachments']).kind
  oneOf(kind, ['directory', 'http', 'jev', 'mail'])
  const item = fields(value, kind === 'directory' ? ['kind', 'alias', 'input', 'access'] : kind === 'http' ? ['kind', 'alias', 'origin', 'methods', 'authentication'] : kind === 'mail' ? ['kind', 'alias', 'connection', 'folders', 'since', 'attachments'] : ['kind', 'alias', 'connection', 'model', 'maxAttempts'])
  key(item.alias)
  if (kind === 'directory') { key(item.input); oneOf(item.access, ['read', 'readWrite']) }
  else if (kind === 'http') {
    key(item.origin)
    const methods = list(item.methods, 6, value => oneOf(value, ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']))
    if (!methods.length) fail('HTTP access requires methods')
    unique(methods)
    if (item.authentication !== null) {
      const authentication = fields(item.authentication, ['type', 'credential', 'subject', 'issuer'])
      if (authentication.type !== 'ddisaAgent') fail('unsupported HTTP authentication')
      key(authentication.credential); key(authentication.subject); key(authentication.issuer)
    }
  }
  else if (kind === 'mail') { key(item.connection); key(item.folders); key(item.since); boolean(item.attachments) }
  else { key(item.connection); key(item.model); integer(item.maxAttempts, 1, 100) }
  return item as unknown as PortableAccess
}
function pod(value: unknown): PortablePod {
  const item = fields(value, ['key', 'title', 'description', 'script', 'packages', 'contract', 'requestedCapabilities', 'access', 'inputs', 'bindings', 'applications', 'assets'], ['schedule'])
  key(item.key); lineText(item.title, 100); text(item.description, 4000, true); portablePath(item.script)
  if (item.packages !== null) { const packages = fields(item.packages, ['manifest', 'lock']); portablePath(packages.manifest); portablePath(packages.lock) }
  if (item.contract !== null) {
    const contract = fields(item.contract, ['takes', 'gives', 'summary'])
    unique(list(contract.takes, 8, channel)); unique(list(contract.gives, 16, channel)); text(contract.summary, 40)
  }
  unique(list(item.requestedCapabilities, 16, (value) => {
    const capability = text(value, 120)
    if (sourceIdentity(capability)) fail('capability contains a source-bound identity')
    if (!['mail.read', 'jev.evaluate'].includes(capability) && !/^tool\.[a-z][a-z0-9_-]{0,63}\.[a-z][a-z0-9_-]{0,31}$/.test(capability) && !/^credential\.[a-z][a-z0-9_-]{0,63}$/.test(capability)) fail('unsupported requested capability')
    return capability
  }))
  item.access = list(item.access, 16, access)
  unique((item.access as PortableAccess[]).map(item => item.alias))
  for (const kind of ['mail', 'jev']) {
    if ((item.access as PortableAccess[]).filter(item => item.kind === kind).length > 1) fail('only one mail or AI scope is supported per Pod')
  }
  item.inputs = inputs(item.inputs); item.bindings = bindings(item.bindings)
  item.applications = list(item.applications, 32, (value) => {
    const binding = fields(value, ['alias', 'requirement', 'account', 'environment'])
    return { alias: key(binding.alias), requirement: key(binding.requirement), account: key(binding.account), environment: bindings(binding.environment, true) }
  })
  unique((item.applications as PortableApplicationBinding[]).map(binding => binding.alias))
  unique((item.applications as PortableApplicationBinding[]).map(binding => binding.account))
  unique(list(item.assets, sharingLimits.files, portablePath))
  if (item.schedule !== undefined && item.schedule !== null) {
    const schedule = fields(item.schedule, ['kind'], ['seconds', 'time', 'timezone'])
    if (schedule.kind === 'interval') { fields(schedule, ['kind', 'seconds']); integer(schedule.seconds, 60, 2592000) }
    else if (schedule.kind === 'daily') {
      fields(schedule, ['kind', 'time', 'timezone'])
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(lineText(schedule.time, 5))) fail('invalid suggested schedule time')
      const timezone = lineText(schedule.timezone, 100)
      try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0) }
      catch { fail('invalid suggested schedule timezone') }
    }
    else {
      fail('unsupported suggested schedule')
    }
  }
  return item as unknown as PortablePod
}
function composition(value: unknown): PortableComposition {
  const item = fields(value, ['key', 'kind', 'title', 'document', 'documentVersion', 'nodes', 'calls', 'inputs', 'dataSchemas'])
  key(item.key); lineText(item.title, 100); portablePath(item.document)
  oneOf(item.kind, ['sequence', 'channels', 'network'])
  if (item.documentVersion !== 1) fail('unsupported composition format')
  item.nodes = list(item.nodes, sharingLimits.pods, (value) => { const node = fields(value, ['pod', 'after', 'handoff']); return { pod: key(node.pod), after: names(node.after, 31), handoff: boolean(node.handoff) } })
  const nodes = item.nodes as PortableNode[]
  if (!nodes.length) fail('empty composition')
  unique(nodes.map(node => node.pod))
  for (const node of nodes) {
    if (node.handoff && !node.after.length) fail('handoff requires a predecessor')
    if (node.after.some(previous => previous === node.pod || !nodes.some(member => member.pod === previous))) fail('dangling predecessor')
    if (item.kind !== 'sequence' && (node.after.length || node.handoff)) fail('channel compositions do not use sequence edges')
  }
  const visited = new Set<string>()
  for (let pass = 0; pass < nodes.length; pass++) {
    for (const node of nodes) {
      if (node.after.every(previous => visited.has(previous))) visited.add(node.pod)
    }
  }
  if (visited.size !== nodes.length) fail('cyclic sequence')
  item.calls = names(item.calls); item.inputs = inputs(item.inputs, item.kind === 'channels' ? sharingLimits.valueCharacters : 1024); unique(list(item.dataSchemas, 32, portablePath))
  if ((item.inputs as PortableInput[]).some(input => !['string', 'number', 'boolean', 'enum'].includes(input.kind))) fail('composition inputs must be public values')
  return item as unknown as PortableComposition
}
function application(value: unknown): PortableApplication {
  const item = fields(value, ['key', 'application', 'adapter', 'testedVersions', 'platforms', 'distribution', 'instructions'])
  key(item.key)
  for (const value of [item.application, fields(item.adapter, ['identity', 'version', 'operations']).identity]) {
    if (!/^[a-z][a-z0-9.-]{0,127}$/.test(text(value, 128))) fail('invalid stable application identity')
  }
  const adapter = item.adapter as Record<string, unknown>; integer(adapter.version, 1, 1000); names(adapter.operations, 64)
  if ((adapter.operations as string[]).length !== 1 || (adapter.operations as string[])[0] !== 'invoke') fail('application adapter requires the native invoke operation')
  unique(list(item.testedVersions, 32, value => lineText(value, 100)))
  const platforms = list(item.platforms, 6, (value) => { const platform = fields(value, ['os', 'architecture']); oneOf(platform.os, ['darwin', 'linux', 'win32']); oneOf(platform.architecture, ['arm64', 'x64']); return `${platform.os}/${platform.architecture}` })
  if (!platforms.length) fail('application requires a supported platform'); unique(platforms)
  if (item.distribution !== null) {
    const distribution = fields(item.distribution, ['kind', 'url']); let url: URL
    try { url = new URL(lineText(distribution.url, 2048)) }
    catch { return fail('invalid distribution reference') }
    if (distribution.kind !== 'official-url' || url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.href !== distribution.url) fail('invalid distribution reference')
  }
  text(item.instructions, 4000, true)
  return item as unknown as PortableApplication
}

export function parsePortableManifest(value: unknown, supportedFeatures: readonly string[]): PortableManifest {
  const clean = JSON.parse(canonicalPortableJson(value))
  if (!clean || typeof clean !== 'object' || Array.isArray(clean) || clean.format !== 'openape-package' || clean.version !== 1) fail('unsupported package version')
  const item = fields(clean, ['format', 'version', 'package', 'requiredFeatures', 'entry', 'pods', 'compositions', 'applications', 'files', 'contentSha256'])
  const features = names(item.requiredFeatures, 32)
  if (!features.includes('portable_aliases_v1')) fail('portable alias feature is required')
  assertPortableCompatibility({ requiredFeatures: features }, supportedFeatures)
  const identity = fields(item.package, ['key', 'revision', 'title', 'description'])
  key(identity.key); integer(identity.revision, 1, Number.MAX_SAFE_INTEGER - 1); lineText(identity.title, 120); text(identity.description, 4000, true)
  names(item.requiredFeatures, 32); hash(item.contentSha256)
  const entry = fields(item.entry, ['kind', 'key']); key(entry.key)
  const pods = list(item.pods, sharingLimits.pods, pod); const compositions = list(item.compositions, 32, composition); const applications = list(item.applications, 32, application)
  if (!pods.length) fail('package has no Pods')
  unique([...pods.map(item => item.key), ...compositions.map(item => item.key)]); unique(applications.map(item => item.key))
  const files = list(item.files, sharingLimits.files - 1, (value): PortableFile => {
    const file = fields(value, ['path', 'kind', 'bytes', 'sha256', 'mediaType'])
    portablePath(file.path); integer(file.bytes, 0, sharingLimits.expandedBytes); hash(file.sha256); lineText(file.mediaType, 100); if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(String(file.mediaType))) fail('invalid media type')
    if (typeof file.kind !== 'string' || !Object.hasOwn(portableFileLimits, file.kind) || String(file.path).split('/')[0]!.toLowerCase() === 'manifest.json') fail('unsupported file kind or reserved path')
    if (Number(file.bytes) > portableFileLimits[file.kind as PortableFileKind]) fail('file exceeds its role limit')
    return file as unknown as PortableFile
  })
  unique(files.map(file => file.path.toLowerCase()))
  const paths = new Set(files.map(file => file.path.toLowerCase()))
  for (const path of paths) {
    const segments = path.split('/')
    for (let length = 1; length < segments.length; length++) {
      if (paths.has(segments.slice(0, length).join('/'))) fail('file and directory paths collide')
    }
  }
  if (files.reduce((sum, file) => sum + file.bytes, new TextEncoder().encode(canonicalPortableJson(clean)).length) > sharingLimits.expandedBytes) fail('expanded package exceeds 100 MiB')
  const usedFiles = new Set<string>()
  const fileReference = (path: string, kind: PortableFileKind) => { if (!files.some(file => file.path === path && file.kind === kind)) fail('dangling or mistyped file reference'); usedFiles.add(path) }
  const groups = new Map<string, string>(); const accountGroups = new Map<string, string>()
  for (const declaration of [...pods.flatMap(pod => pod.inputs), ...compositions.flatMap(composition => composition.inputs)]) {
    if (!declaration.sharingGroup) continue
    const { key: _key, label: _label, description: _description, ...contract } = declaration
    const signature = canonicalPortableJson(contract)
    if (groups.has(declaration.sharingGroup) && groups.get(declaration.sharingGroup) !== signature) fail('incompatible shared input declarations')
    groups.set(declaration.sharingGroup, signature)
  }
  for (const pod of pods) {
    if (entry.kind !== 'pod' && pod.schedule != null) fail('composition members cannot carry standalone schedules')
    if (pod.inputs.some(input => input.kind === 'account' && !pod.applications.some(binding => binding.account === input.key))) fail('unbound account input')
    fileReference(pod.script, 'script')
    if (pod.packages) { fileReference(pod.packages.manifest, 'package-manifest'); fileReference(pod.packages.lock, 'package-lock') }
    for (const asset of pod.assets) fileReference(asset, 'asset')
    unique([...pod.applications.map(binding => binding.alias), ...pod.access.map(item => item.alias)])
    const inputReference = (key: string, kind: PortableInputKind) => { if (!pod.inputs.some(input => input.key === key && input.kind === kind)) fail('dangling or mistyped access input') }
    for (const request of pod.access) {
      if (request.kind === 'directory') {
        inputReference(request.input, 'directory')
      }
      else if (request.kind === 'http') {
        inputReference(request.origin, 'string')
        if (request.authentication !== null) {
          inputReference(request.authentication.subject, 'string'); inputReference(request.authentication.issuer, 'string')
          unique([request.origin, request.authentication.subject, request.authentication.issuer])
          const subject = pod.inputs.find(input => input.key === request.authentication!.subject)!
          if (subject.sharingGroup !== null || Object.hasOwn(subject, 'default')) fail('HTTP agent identity requires recipient selection')
          if (!pod.bindings.some(binding => binding.alias === request.authentication!.credential && pod.inputs.some(input => input.key === binding.input && input.kind === 'secret'))) fail('HTTP authentication requires a declared recipient secret')
        }
      }
      else if (request.kind === 'mail') {
        inputReference(request.connection, 'connection'); inputReference(request.folders, 'string'); inputReference(request.since, 'string')
        if (Object.hasOwn(pod.inputs.find(input => input.key === request.folders)!, 'default')) fail('mail folder identities require recipient selection')
      }
      else { inputReference(request.connection, 'connection'); inputReference(request.model, 'string') }
    }
    for (const binding of pod.bindings) {
      if (!pod.inputs.some(input => input.key === binding.input && ['string', 'number', 'boolean', 'enum', 'secret'].includes(input.kind))) fail('dangling or invalid input binding')
    }
    for (const binding of pod.applications.flatMap(application => application.environment)) {
      const input = pod.inputs.find(input => input.key === binding.input && ['string', 'number', 'boolean', 'enum'].includes(input.kind))
      if (!input) fail('invalid environment input binding')
      if ([input.default, ...(input.choices ?? [])].some(value => typeof value === 'string' && /[\r\n]/.test(value))) fail('environment values must be plain lines')
    }
    for (const capability of pod.requestedCapabilities) {
      if (capability === 'mail.read') { if (!pod.access.some(item => item.kind === 'mail')) fail('undeclared mail access'); continue }
      if (capability === 'jev.evaluate') { if (!pod.access.some(item => item.kind === 'jev')) fail('undeclared AI access'); continue }
      const [kind, alias, operation] = capability.split('.')
      if (kind === 'credential') {
        if (!pod.bindings.some(binding => binding.alias === alias && pod.inputs.some(input => input.key === binding.input && input.kind === 'secret'))) fail('undeclared credential alias')
        continue
      }
      const binding = pod.applications.find(binding => binding.alias === alias)
      const requirement = applications.find(item => item.key === binding?.requirement)
      if (!requirement?.adapter.operations.includes(operation!) && !pod.access.some(item => item.alias === alias && item.kind === 'http' && operation === 'request')) fail('undeclared tool operation')
    }
    for (const binding of pod.applications) {
      const account = pod.inputs.find(input => input.key === binding.account && input.kind === 'account')
      if (!applications.some(application => application.key === binding.requirement) || !account) fail('dangling application or account binding')
      if (account.sharingGroup) {
        if (accountGroups.has(account.sharingGroup) && accountGroups.get(account.sharingGroup) !== binding.requirement) fail('shared account requires the same application requirement')
        accountGroups.set(account.sharingGroup, binding.requirement)
      }
    }
    const usedInputs = new Set([
      ...pod.bindings.map(binding => binding.input),
      ...pod.applications.flatMap(binding => [binding.account, ...binding.environment.map(item => item.input)]),
      ...pod.access.flatMap(item => item.kind === 'directory' ? [item.input] : item.kind === 'http' ? [item.origin, ...(item.authentication === null ? [] : [item.authentication.subject, item.authentication.issuer])] : item.kind === 'mail' ? [item.connection, item.folders, item.since] : [item.connection, item.model]),
    ])
    if (pod.inputs.some(input => !usedInputs.has(input.key))) fail('unreferenced Pod input')
  }
  for (const composition of compositions) {
    fileReference(composition.document, 'composition'); for (const schema of composition.dataSchemas) fileReference(schema, 'data-schema')
    if (composition.nodes.some(node => !pods.some(pod => pod.key === node.pod))) fail('dangling Pod reference')
    if (composition.calls.some(key => key === composition.key || !compositions.some(target => target.key === key && target.kind !== 'network'))) fail('dangling workflow call')
  }
  if (entry.kind === 'pod') { if (!pods.some(pod => pod.key === entry.key) || pods.length !== 1 || compositions.length) fail('invalid single Pod entry') }
  else if (!compositions.some(composition => composition.key === entry.key && composition.kind === entry.kind)) {
    fail('invalid composition entry')
  }
  if (entry.kind !== 'pod') {
    const reached = new Set<string>(); const visiting = new Set<string>(); const members = new Set<string>()
    const visit = (key: string) => {
      if (visiting.has(key)) fail('cyclic workflow calls')
      if (reached.has(key)) return
      visiting.add(key)
      const composition = compositions.find(item => item.key === key)!
      for (const node of composition.nodes) { if (members.has(node.pod)) fail('Pod instance belongs to multiple compositions'); members.add(node.pod) }
      for (const target of composition.calls) visit(target)
      visiting.delete(key); reached.add(key)
    }
    visit(entry.key as string)
    if (reached.size !== compositions.length || members.size !== pods.length) fail('unreachable composition or Pod')
  }
  for (const application of applications) {
    if (!pods.some(pod => pod.applications.some(binding => binding.requirement === application.key))) fail('unused application requirement')
  }
  if (usedFiles.size !== files.length) fail('unreferenced file')
  return { ...item, pods, compositions, applications, files } as unknown as PortableManifest
}

export function portableContentBytes(value: PortableManifest, supportedFeatures: readonly string[]): Uint8Array {
  const { contentSha256: _digest, ...content } = parsePortableManifest(value, supportedFeatures)
  content.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return new TextEncoder().encode(canonicalPortableJson(content))
}

export function assertPortableCompatibility(manifest: Pick<PortableManifest, 'requiredFeatures'>, supportedFeatures: readonly string[]): void {
  const unsupported = manifest.requiredFeatures.filter(feature => !supportedFeatures.includes(feature))
  if (unsupported.length) fail(`runtime does not support: ${unsupported.join(', ')}`)
}

export function portableKey(value: unknown): string { return key(value) }
