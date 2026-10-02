import { loadAdapter } from '@openape/apes'
import { canonicalPortableJson, portableKey } from '@openape/pods-protocol'
import type { PortableApplication, PortableInput, PortableInputKind, PortablePod } from '@openape/pods-protocol'
import type { ProgramAssignment } from '../../contracts/programs'
import { parseHttpAuthentication } from '../../contracts/http'
import { applicationBundle } from '../../main/programs/application'
import { portableLauncher } from '../../main/programs/requirements'
import { readPortableAssets } from './assets'
import type { PortableAssetSelection } from './assets'
import type { PortablePodSource } from './source'
import type { PortablePayload } from './package'

export interface PortablePodChoices { podId: string, key: string, title?: string, description: string, defaults: string[], aliases: { resourceId: string, alias: string }[], assets: PortableAssetSelection[], omittedReferences?: string[] }

export class PortableInputs {
  readonly declarations: PortableInput[] = []
  private readonly selected: Set<string>
  private readonly offered = new Set<string>()
  constructor(defaults: readonly string[]) {
    if (defaults.length > 32 || new Set(defaults).size !== defaults.length) throw new Error('Invalid portable default selection')
    this.selected = new Set(defaults)
  }

  add(reference: string, label: string, kind: PortableInputKind, value?: unknown): string {
    if (this.offered.has(reference)) throw new Error('Duplicate portable input source')
    this.offered.add(reference)
    const key = `input_${this.declarations.length + 1}`
    const declaration: PortableInput = { key, label, description: '', kind, required: true, sharingGroup: null }
    if (this.selected.has(reference)) {
      const valueKind = typeof value
      if (!['string', 'number', 'boolean'].includes(kind) || valueKind !== kind) throw new Error('Portable defaults require an explicitly selected public scalar')
      declaration.default = value as string | number | boolean
    }
    this.declarations.push(declaration)
    return key
  }

  finish(): PortableInput[] {
    if ([...this.selected].some(reference => !this.offered.has(reference))) throw new Error('Portable default selection no longer matches the source')
    return this.declarations
  }
}

export function portableScriptSource(source: PortablePodSource): string {
  const { manifest, content } = source
  const binding = `\n/* Pods binding: assignment ${manifest.assignmentRevision}; dependencies ${manifest.dependencyLockHash}; capabilities ${manifest.capabilities.join(',')} */\n`
  return content.endsWith(binding) ? content.slice(0, -binding.length) : content
}

async function applicationRequirement(configuration: ProgramAssignment, key: string): Promise<PortableApplication> {
  if (configuration.runtime || configuration.entryFiles.length || configuration.networkHosts.length || configuration.cacheArgument) throw new Error('Portable application export requires recipient setup for custom runtimes, entry files, cache arguments or network hosts')
  if (!['darwin', 'linux', 'win32'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch)) throw new Error('Unsupported portable application platform')
  let application: string; let adapter: PortableApplication['adapter']
  if (configuration.bundlePath) {
    const bundle = await applicationBundle(configuration.bundlePath)
    if (!bundle.identity || bundle.executable !== configuration.executable || bundle.executableHash !== configuration.executableHash) throw new Error('Application changed or has no portable identity')
    application = bundle.identity; adapter = { ...portableLauncher, operations: ['invoke'] }
  }
  else {
    const loaded = loadAdapter(configuration.cliId, configuration.adapterPath)
    const cli = loaded.adapter.cli
    if (loaded.digest !== `SHA-256:${configuration.adapterHash}` || cli.executable !== configuration.cliId || !cli.version || !/^[1-9]\d{0,2}$/.test(cli.version)) throw new Error('Application adapter changed or has no portable version')
    application = cli.executable; adapter = { identity: cli.id, version: Number(cli.version), operations: ['invoke'] }
  }
  return { key, application, adapter, testedVersions: [], platforms: [{ os: process.platform as 'darwin' | 'linux' | 'win32', architecture: process.arch as 'arm64' | 'x64' }], distribution: null, instructions: '' }
}

export async function mapPortablePod(root: string, source: PortablePodSource, choices: PortablePodChoices, networkFields?: Record<string, { value: unknown, kind?: string, origin?: string }>) {
  if (choices.podId !== source.pod.id) throw new Error('Portable Pod selection no longer matches its source')
  const key = portableKey(choices.key)
  const inputs = new PortableInputs(choices.defaults)
  const pod: PortablePod = { key, title: choices.title ?? source.pod.name, description: choices.description, script: `pods/${key}/run.mjs`, packages: null, contract: source.manifest.contract ?? null, requestedCapabilities: [], access: [], inputs: [], bindings: [], applications: [], assets: [], schedule: source.schedule?.spec ?? null }
  const payloads: PortablePayload[] = [{ path: pod.script, kind: 'script', mediaType: 'text/javascript', content: Buffer.from(portableScriptSource(source)) }]
  const applications: PortableApplication[] = []
  const capabilities = new Map<string, string>()
  const references = source.resources.filter(resource => resource.kind === 'reference' && resource.state !== 'revoked').map(resource => resource.id)
  const decisions = [...choices.assets.map(asset => asset.resourceId), ...(choices.omittedReferences ?? [])]
  if (new Set(decisions).size !== decisions.length || decisions.length !== references.length || references.some(id => !decisions.includes(id))) throw new Error('Select or explicitly omit every source reference before exporting')
  const aliases = new Map(choices.aliases.map(item => [item.resourceId, portableKey(item.alias)]))
  if (aliases.size !== choices.aliases.length || choices.aliases.some(item => !source.resources.some(resource => resource.id === item.resourceId && resource.state !== 'revoked'))) throw new Error('Portable resource aliases no longer match the source')
  for (const variable of source.variables) pod.bindings.push({ alias: portableKey(variable.name), input: inputs.add(`variable:${variable.name}`, variable.name, 'string', variable.value) })
  for (const declaration of source.definitions) {
    const name = portableKey(declaration.name)
    if (pod.bindings.some(binding => binding.alias === name)) throw new Error('Portable configuration and variable aliases must be distinct')
    const override = source.overrides.find(item => item.name === name)
    const field = networkFields?.[name] ?? { kind: String(declaration.kind), value: JSON.parse(String((override ?? declaration).value)), origin: override ? 'pod' : 'definition' }
    if (field.origin === 'composition' && choices.defaults.includes(`configuration:${name}`)) throw new Error('Choose shared configuration defaults on the composition')
    const kind = field.kind === 'secret-reference' ? 'secret' : typeof field.value
    if (!['secret', 'string', 'number', 'boolean'].includes(kind)) throw new Error('Portable configuration requires public scalars or secret declarations')
    pod.bindings.push({ alias: name, input: inputs.add(`configuration:${name}`, name, kind as PortableInputKind, kind === 'secret' ? undefined : field.value) })
  }
  if (source.overrides.some(item => !source.definitions.some(declaration => declaration.name === item.name))) throw new Error('Portable configuration contains an undeclared override')
  for (const resource of source.resources) {
    if (resource.state === 'revoked' || resource.kind === 'reference' || resource.kind === 'connection') continue
    if (resource.state !== 'ready') throw new Error('Resolve unavailable resource assignments before exporting')
    const configuration = resource.configuration
    if (resource.kind === 'credential') {
      const alias = portableKey(configuration.alias)
      pod.bindings.push({ alias, input: inputs.add(`secret:${alias}`, alias, 'secret') })
      capabilities.set(`credential.${alias}`, `credential.${alias}`)
      continue
    }
    const alias = aliases.get(resource.id)
    if (!alias) throw new Error('Choose a portable alias for every exported resource')
    if (resource.kind === 'directory') {
      if (!['read', 'readWrite'].includes(String(configuration.access))) throw new Error('Unsupported portable directory access')
      pod.access.push({ kind: 'directory', alias, input: inputs.add(`directory:${resource.id}`, alias, 'directory'), access: configuration.access as 'read' | 'readWrite' })
    }
    else if (configuration.type === 'program') {
      const program = configuration as unknown as ProgramAssignment
      const requirement = await applicationRequirement(program, `${key}_${alias}`)
      applications.push(requirement)
      const environment = Object.entries(program.environment).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => ({ alias: name, input: inputs.add(`environment:${resource.id}:${name}`, name, 'string', value) }))
      pod.applications.push({ alias, requirement: requirement.key, account: inputs.add(`account:${resource.id}`, alias, 'account'), environment })
      capabilities.set(program.capability, `tool.${alias}.invoke`)
    }
    else if (configuration.type === 'http') {
      const authentication = configuration.authentication === undefined ? null : parseHttpAuthentication(configuration.authentication)
      pod.access.push({ kind: 'http', alias, origin: inputs.add(`http:${resource.id}:origin`, `${alias} origin`, 'string', configuration.origin), methods: structuredClone(configuration.methods) as string[], authentication: authentication ? { type: 'ddisaAgent', credential: authentication.credential, subject: inputs.add(`http:${resource.id}:subject`, `${alias} agent identity`, 'string'), issuer: inputs.add(`http:${resource.id}:issuer`, `${alias} identity issuer`, 'string', authentication.issuer) } : null })
      capabilities.set(String(configuration.capability), `tool.${alias}.request`)
    }
    else if (configuration.type === 'jev') {
      pod.access.push({ kind: 'jev', alias, connection: inputs.add(`jev:${resource.id}:connection`, `${alias} connection`, 'connection'), model: inputs.add(`jev:${resource.id}:model`, `${alias} model`, 'string', configuration.model), maxAttempts: Number(configuration.maxAttempts) })
      capabilities.set('jev.evaluate', 'jev.evaluate')
    }
    else if (configuration.capability === 'mail.read') {
      pod.access.push({ kind: 'mail', alias, connection: inputs.add(`mail:${resource.id}:connection`, `${alias} connection`, 'connection'), folders: inputs.add(`mail:${resource.id}:folders`, `${alias} folders`, 'string'), since: inputs.add(`mail:${resource.id}:since`, `${alias} since`, 'string', configuration.since ?? ''), attachments: Boolean(configuration.attachments) })
      capabilities.set('mail.read', 'mail.read')
    }
    else {
      throw new Error('This resource configuration does not support portable export')
    }
  }
  for (const capability of source.manifest.capabilities) {
    const portable = capabilities.get(capability)
    if (!portable) throw new Error('Portable capability has no explicit resource declaration')
    pod.requestedCapabilities.push(portable)
  }
  if (source.lock !== null) {
    pod.packages = { manifest: `pods/${key}/package.json`, lock: `pods/${key}/package-lock.json` }
    payloads.push({ path: pod.packages.manifest, kind: 'package-manifest', mediaType: 'application/json', content: Buffer.from(canonicalPortableJson(source.packages)) }, { path: pod.packages.lock, kind: 'package-lock', mediaType: 'application/json', content: Buffer.from(source.lock) })
  }
  const assets = await readPortableAssets(root, source, choices.assets)
  payloads.push(...assets); pod.assets = assets.map(file => file.path); pod.inputs = inputs.finish()
  return { pod, applications, payloads }
}
