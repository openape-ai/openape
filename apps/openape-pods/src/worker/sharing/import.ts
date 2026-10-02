import { randomUUID } from 'node:crypto'
import { mkdir, open, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseOwner, canonicalPortableJson  } from '@openape/pods-protocol'
import type { Owner, PortableInput, PortableManifest, PortablePod } from '@openape/pods-protocol'
import { parsePackages } from '../../contracts/dependencies'
import type { PackageManifest } from '../../contracts/dependencies'
import type { PortableImportCommand, PortableImportRequirement, PortableImportState, PortableImportValues, PortableImportView, PortableValue } from '../../contracts/sharing'
import type { PodResource } from '../../contracts/resources'
import { podDirectories } from '../../runtime/environment'
import { syncDirectory, syncTree } from '../data/files'
import { DependencyStore } from '../dependencies/store'
import type { ResourceRegistry } from '../resources/registry'
import { PodVariables } from '../resources/variables'
import type { ScriptRuntime } from '../runs/runner'
import type { WorkflowEngine } from '../workflows/engine'
import type { NetworkEngine } from '../scheduling/network-engine'
import type { DefinitionCatalog } from '../workspace/definition-catalog'
import { assertApproved, assertFreshMembers, clip, finalizeNetwork, joinGroup, needsApprovedMembers, variableMatches, workflowCommand } from './compositions'
import type { CompositionContext, CompositionDocument } from './compositions'
import type { CommitPoint, PodDatabase } from '../storage/database'
import { readPortableArchive } from './archive'

// Importer support only; the runtime does not advertise portable aliases as a script capability.
export const importFormatFeatures = ['portable_aliases_v1'] as const
// bundles holds, per alias, the executable hash of the application bundle whose identity the main process verified at binding.
interface PodSetup { resources: PodResource[], aliases: Map<string, PodResource>, variables: Record<string, string>, dependencies: boolean, bundles: Record<string, string> }
interface ImportSetup { values: PortableImportValues, drafts?: Record<string, string>, packages?: Record<string, PackageManifest>, bundles?: Record<string, Record<string, string>>, compositions?: Record<string, { workflowId?: string, networkId?: string }>, deferred?: string[] }
export interface ImportEngines { workflows: WorkflowEngine, networks: NetworkEngine, catalog: DefinitionCatalog }
type VerifiedBundle = { executableHash: string, identity?: string } | null | undefined

const scalarKinds = ['string', 'number', 'boolean', 'enum']
// One commit writes an import's files at a time; a second commit or a cancel must not interleave with it.
const committing = new Set<string>()
const decoder = new TextDecoder('utf-8', { fatal: true })
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)

function scopes(manifest: PortableManifest): { scope: 'pods' | 'compositions', key: string, inputs: PortableInput[] }[] {
  return [...manifest.pods.map(pod => ({ scope: 'pods' as const, key: pod.key, inputs: pod.inputs })), ...manifest.compositions.map(item => ({ scope: 'compositions' as const, key: item.key, inputs: item.inputs }))]
}

function resolved(values: PortableImportValues, scope: 'pods' | 'compositions', key: string, input: PortableInput): PortableValue | undefined {
  return values[scope][key]?.[input.key] ?? input.default
}

function assertValue(input: PortableInput, value: PortableValue, limit: number): void {
  if (!scalarKinds.includes(input.kind)) throw new Error('Resource and secret inputs are bound through setup, not entered as values')
  const valid = input.kind === 'number'
    ? typeof value === 'number' && Number.isFinite(value) && (input.minimum === undefined || value >= input.minimum) && (input.maximum === undefined || value <= input.maximum)
    : input.kind === 'boolean'
      ? typeof value === 'boolean'
      : typeof value === 'string' && value.length <= limit && !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value) && (input.kind !== 'enum' || input.choices!.includes(value))
  if (!valid) throw new Error(`Value does not match the declared input ${input.key}`)
}

// The effective value of a declared input: the Pod's own variable once the copy exists, otherwise the journal value or declared default.
function inputValue(pod: PortablePod, values: PortableImportValues, variables: Record<string, string> | undefined, key: string): PortableValue | undefined {
  const alias = variables && pod.bindings.find(binding => binding.input === key)?.alias
  return alias ? variables[alias] : resolved(values, 'pods', pod.key, pod.inputs.find(input => input.key === key)!)
}

// Whether one ready local assignment matches what the package declared for an alias.
function satisfies(manifest: PortableManifest, pod: PortablePod, alias: string, resource: PodResource | undefined, value: (key: string) => PortableValue | undefined, bundle: VerifiedBundle): boolean {
  if (resource?.state !== 'ready') return false
  const configuration = resource.configuration
  const application = pod.applications.find(item => item.alias === alias)
  if (application) {
    const required = manifest.applications.find(item => item.key === application.requirement)!.application
    // A bundle's identity is plist metadata only the main process can read. It is verified at binding together with the executable hash, which must still match.
    const identified = configuration.bundlePath ? !!bundle && bundle.executableHash === configuration.executableHash && (bundle.identity === undefined || bundle.identity === required) : configuration.cliId === required
    return configuration.type === 'program' && identified && application.environment.every(item => value(item.input) !== undefined && (configuration.environment as Record<string, string> | undefined)?.[item.alias] === String(value(item.input)))
  }
  const access = pod.access.find(item => item.alias === alias)
  if (access?.kind === 'directory') return resource.kind === 'directory' && configuration.access === access.access
  if (access?.kind === 'jev') return configuration.type === 'jev' && configuration.model === value(access.model) && Number(configuration.maxAttempts) <= access.maxAttempts
  if (access?.kind === 'mail') {
    const folders = value(access.folders)
    return configuration.capability === 'mail.read' && configuration.attachments === access.attachments && (configuration.since ?? '') === value(access.since) && typeof folders === 'string' && canonicalPortableJson(configuration.folders) === canonicalPortableJson(JSON.parse(folders))
  }
  if (access?.kind !== 'http' || configuration.type !== 'http' || configuration.origin !== value(access.origin) || access.methods.some(method => !(configuration.methods as string[]).includes(method))) return false
  const expected = access.authentication ? { type: 'ddisaAgent', credential: access.authentication.credential, subject: value(access.authentication.subject), issuer: value(access.authentication.issuer) } : undefined
  const actual = configuration.authentication as Record<string, unknown> | undefined
  return expected ? !!actual && Object.entries(expected).every(([name, item]) => actual[name] === item) : actual === undefined
}

function unresolved(manifest: PortableManifest, values: PortableImportValues, setup: (podKey: string) => PodSetup | undefined, composed: (key: string) => boolean): PortableImportRequirement[] {
  const result: PortableImportRequirement[] = []
  for (const item of scopes(manifest)) {
    const pod = manifest.pods.find(pod => item.scope === 'pods' && pod.key === item.key); const variables = pod && setup(pod.key)?.variables
    for (const input of item.inputs) {
      // Every composition input is referenced by its document, so it is needed regardless of its required flag.
      if ((!input.required && item.scope === 'pods') || !scalarKinds.includes(input.kind)) continue
      // Once the copy exists a variable input lives on the Pod, where the owner sets or changes it.
      const aliases = variables ? pod.bindings.filter(binding => binding.input === input.key).map(binding => binding.alias) : []
      const open = aliases.length ? aliases.some(alias => !variableMatches(input, variables![alias])) : resolved(values, item.scope, item.key, input) === undefined
      if (open) result.push({ scope: item.scope === 'pods' ? 'pod' : 'composition', key: item.key, requirement: 'value', name: input.key })
    }
  }
  for (const pod of manifest.pods) {
    const local = setup(pod.key)
    const matches = (alias: string, resource: PodResource | undefined) => satisfies(manifest, pod, alias, resource, key => inputValue(pod, values, local?.variables, key), local?.bundles[alias] ? { executableHash: local.bundles[alias] } : null)
    for (const binding of pod.bindings) {
      const input = pod.inputs.find(item => item.key === binding.input)!
      if (input.kind === 'secret' && input.required && !local?.resources.some(resource => resource.kind === 'credential' && resource.state === 'ready' && resource.configuration.alias === binding.alias)) result.push({ scope: 'pod', key: pod.key, requirement: 'secret', name: binding.alias })
    }
    for (const access of pod.access) {
      // Jev and mail are single unaliased scopes of a Pod; directories and HTTP tools are bound by alias.
      const resource = access.kind === 'jev' || access.kind === 'mail' ? local?.resources.find(item => matches(access.alias, item)) : local?.aliases.get(access.alias)
      if (!matches(access.alias, resource)) result.push({ scope: 'pod', key: pod.key, requirement: 'access', name: access.alias })
    }
    for (const application of pod.applications) {
      if (!matches(application.alias, local?.aliases.get(application.alias))) result.push({ scope: 'pod', key: pod.key, requirement: 'application', name: application.alias })
    }
    if (pod.packages && !local?.dependencies) result.push({ scope: 'pod', key: pod.key, requirement: 'dependencies', name: null })
  }
  for (const composition of manifest.compositions) {
    if (!composed(composition.key)) result.push({ scope: 'composition', key: composition.key, requirement: 'composition', name: null })
  }
  return result
}

// A stage-time check of what the native workflow parser would refuse later; mail policies are checked at finalization against bound resources.
function assertImportable(manifest: PortableManifest, files: ReadonlyMap<string, Uint8Array>): string[] {
  const ids = new Map(manifest.pods.map((pod, index) => [pod.key, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]))
  const synthetic: CompositionContext = { store: undefined as never, resources: undefined as never, owner: { issuer: 'https://synthetic.invalid', subject: 'synthetic' }, manifest, podId: key => ids.get(key)!, value: () => '', workflowId: () => undefined }
  const deferred: string[] = []
  for (const composition of manifest.compositions) {
    const document = JSON.parse(decoder.decode(files.get(composition.document)!)) as CompositionDocument
    if (needsApprovedMembers(manifest, composition, document)) deferred.push(composition.key)
    if (composition.kind !== 'network' && document.mail == null) workflowCommand(synthetic, composition, document, '00000000-0000-4000-8000-000000000100', composition.kind === 'channels' ? '00000000-0000-4000-8000-000000000100' : null)
  }
  return deferred
}

async function writePrivate(path: string, content: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const file = await open(path, 'w', 0o600)
  try { await file.writeFile(content); await file.sync() }
  finally { await file.close() }
}

export class PortableImporter {
  private readonly owner: Owner
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, owner: Owner, private readonly npmRoot: string) { this.owner = parseOwner(owner) }

  private row(id: string) {
    if (!uuid(id)) throw new Error('Invalid import request identity')
    const row = this.store.db.prepare('SELECT * FROM portable_imports WHERE id=?').get(id)
    if (row && (row.owner_issuer !== this.owner.issuer || row.owner_subject !== this.owner.subject)) throw new Error('Import request belongs to another owner')
    return row
  }

  private required(id: string, expectedRevision?: number) {
    const row = this.row(id)
    if (!row) throw new Error('Import not found')
    if (expectedRevision !== undefined && row.revision !== expectedRevision) throw new Error('Import changed; reload before continuing')
    return row
  }

  private pods(id: string): { key: string, podId: string }[] {
    return this.store.db.prepare('SELECT key,pod_id FROM portable_import_pods WHERE import_id=? ORDER BY rowid').all(id).map(row => ({ key: row.key as string, podId: row.pod_id as string }))
  }

  private advance(id: string, changes = '', ...values: (string | null)[]): void {
    this.store.db.prepare(`UPDATE portable_imports SET ${changes && `${changes},`}revision=revision+1,updated_at=? WHERE id=?`).run(...values, Date.now(), id)
  }

  private podSetup(podId: string, pod: PortablePod, setup: ImportSetup): PodSetup {
    const packages = setup.packages?.[pod.key]
    const dependencies = !pod.packages || (!!packages && (!Object.keys(packages.dependencies).length || new DependencyStore(this.store).prepared(podId, packages) !== null))
    return { resources: this.resources.list(podId), aliases: new Map(this.resources.aliases(podId).map(item => [item.alias, item.resource])), variables: new PodVariables(this.store).values(podId), dependencies, bundles: setup.bundles?.[pod.key] ?? {} }
  }

  view(id: string): PortableImportView {
    const row = this.required(id); const manifest = JSON.parse(row.manifest as string) as PortableManifest
    const setup = JSON.parse(row.setup as string) as ImportSetup; const values = setup.values
    // Once the copy exists, a Pod the owner deleted no longer needs setup.
    const pods = this.pods(id).filter(pod => row.state === 'staged' || this.store.db.prepare('SELECT 1 FROM pods WHERE id=?').get(pod.podId))
    const usable = (key: string) => pods.some(pod => pod.key === key && (row.state === 'staged' || this.store.getPod(pod.podId).lifecycle !== 'archived'))
    const compositions = Object.entries(setup.compositions ?? {}).map(([key, created]) => ({ key, workflowId: created.workflowId && this.store.db.prepare('SELECT 1 FROM workflows WHERE id=? AND archived=0').get(created.workflowId) ? created.workflowId : null, networkId: created.networkId && this.store.db.prepare('SELECT 1 FROM networks WHERE id=? AND state!=\'archived\'').get(created.networkId) ? created.networkId : null })).filter(item => item.workflowId || item.networkId)
    const open = unresolved(manifest, values, (key) => {
      const pod = row.state === 'staged' ? undefined : pods.find(item => item.key === key)
      return pod && this.podSetup(pod.podId, manifest.pods.find(item => item.key === key)!, setup)
    }, key => compositions.some(item => item.key === key))
      // A deleted or archived Pod needs no setup, a composition that lost a member can no longer be created, and only deferred compositions outlive completion.
      .filter(item => item.scope === 'pod' ? usable(item.key) : row.state === 'staged' || ((row.state === 'committed' || (row.state === 'completed' && (setup.deferred ?? []).includes(item.key))) && manifest.compositions.find(composition => composition.key === item.key)!.nodes.every(node => usable(node.pod))))
    return { id, state: row.state as PortableImportView['state'], revision: row.revision as number, transferSha256: row.transfer_hash as string, manifest, pods, compositions, values, unresolved: open, error: row.error as string | null }
  }

  list(): PortableImportView[] {
    this.store.transaction(() => forgetFinishedImports(this.store))
    const views = this.store.db.prepare('SELECT id FROM portable_imports WHERE owner_issuer=? AND owner_subject=? AND (state IN (\'staged\',\'committed\') OR (state=\'completed\' AND archive_hash IS NOT NULL)) ORDER BY created_at').all(this.owner.issuer, this.owner.subject).map(row => this.view(row.id as string))
    // A completed import whose deferred compositions are all created or impossible no longer needs its archive.
    for (const view of views.filter(view => view.state === 'completed' && !view.unresolved.length)) this.store.db.prepare('UPDATE portable_imports SET archive_hash=NULL WHERE id=?').run(view.id)
    return views.filter(view => view.state !== 'completed' || view.unresolved.length)
  }

  async inspect(archive: Uint8Array): Promise<{ manifest: PortableManifest, transferSha256: string }> {
    const { manifest, transferSha256 } = await readPortableArchive(archive, this.npmRoot, importFormatFeatures)
    return { manifest, transferSha256 }
  }

  async stage(id: string, archive: Uint8Array, observe: (point: CommitPoint) => void = () => {}): Promise<PortableImportView> {
    this.row(id)
    const bytes = Buffer.from(archive)
    const { manifest, files, transferSha256 } = await readPortableArchive(bytes, this.npmRoot, importFormatFeatures)
    const deferred = assertImportable(manifest, files)
    return this.store.transaction(() => {
      const existing = this.row(id)
      if (existing) {
        if (existing.transfer_hash !== transferSha256) throw new Error('Import request was reused with a different package')
        return this.view(id)
      }
      forgetFinishedImports(this.store)
      if (Number(this.store.db.prepare('SELECT count(*) AS count FROM portable_imports WHERE archive_hash IS NOT NULL').get()!.count) >= 8) throw new Error('Finish or cancel an existing import before starting another')
      if (this.store.putBlob(bytes, observe) !== transferSha256) throw new Error('Portable archive changed during staging')
      const now = Date.now()
      this.store.db.prepare('INSERT OR IGNORE INTO network_owners VALUES(?,?)').run(this.owner.issuer, this.owner.subject)
      this.store.db.prepare('INSERT INTO portable_imports VALUES(?,?,?,?,?,?,\'staged\',1,?,?,NULL,?,?)').run(id, this.owner.issuer, this.owner.subject, transferSha256, manifest.contentSha256, transferSha256, JSON.stringify(manifest), JSON.stringify({ values: { pods: {}, compositions: {} }, deferred }), now, now)
      for (const pod of manifest.pods) this.store.db.prepare('INSERT INTO portable_import_pods VALUES(?,?,?)').run(id, pod.key, randomUUID())
      observe('beforeCommit')
      return this.view(id)
    })
  }

  configure(id: string, expectedRevision: number, changes: PortableImportValues): PortableImportView {
    return this.store.transaction(() => {
      const row = this.required(id, expectedRevision)
      if (row.state !== 'staged' && row.state !== 'committed') throw new Error('Values can only change during import setup')
      const manifest = JSON.parse(row.manifest as string) as PortableManifest
      const setup = JSON.parse(row.setup as string) as ImportSetup
      for (const scope of ['pods', 'compositions'] as const) {
        for (const [key, entries] of Object.entries(changes[scope] ?? {})) {
          const inputs = scopes(manifest).find(item => item.scope === scope && item.key === key)?.inputs
          if (!inputs) throw new Error('Value targets an undeclared package member')
          for (const [name, value] of Object.entries(entries)) {
            const input = inputs.find(item => item.key === name)
            if (!input) throw new Error('Value targets an undeclared input')
            // A value entered for one member of an explicit sharing group is the value of the whole group.
            const members = input.sharingGroup === null ? [{ scope, key, input }] : scopes(manifest).flatMap(item => item.inputs.filter(candidate => candidate.sharingGroup === input.sharingGroup).map(candidate => ({ scope: item.scope, key: item.key, input: candidate })))
            // Pod values become native variables; composition values are rechecked by their native parser at finalization.
            if (value !== null) assertValue(input, value, members.some(member => member.scope === 'pods') ? 2048 : 16384)
            // Variable inputs were copied into native Pod variables at commit; from then on the owner edits them on the Pod.
            const variable = (member: typeof members[number]) => row.state === 'committed' && member.scope === 'pods' && manifest.pods.find(pod => pod.key === member.key)!.bindings.some(binding => binding.input === member.input.key)
            if (variable({ scope, key, input })) throw new Error('This value is now a Pod variable; change it on the Pod')
            for (const member of members.filter(member => !variable(member))) {
              const target = setup.values[member.scope][member.key] ??= {}
              if (value === null) delete target[member.input.key]
              else target[member.input.key] = value
            }
          }
        }
      }
      this.advance(id, 'setup=?', JSON.stringify(setup))
      return this.view(id)
    })
  }

  async commit(id: string, expectedRevision: number, observe: (point: CommitPoint) => void = () => {}): Promise<PortableImportView> {
    const row = this.required(id)
    if (row.state === 'committed' || row.state === 'completed') return this.view(id)
    if (row.state !== 'staged' || row.revision !== expectedRevision || committing.has(id)) throw new Error('Import changed; reload before creating the paused copy')
    const ids = new Map(this.pods(id).map(item => [item.key, item.podId]))
    const setup = JSON.parse(row.setup as string) as ImportSetup; const values = setup.values
    const drafts: Record<string, string> = {}; const prepared: Record<string, PackageManifest> = {}; const assets = new Map<string, string>()
    committing.add(id)
    try {
      const { manifest, files } = await readPortableArchive(this.store.readBlob(row.archive_hash as string), this.npmRoot, importFormatFeatures)
      this.store.assertStorage(manifest.pods.flatMap(pod => pod.assets).reduce((total, path) => total + files.get(path)!.byteLength, 0))
      for (const pod of manifest.pods) {
        const { workspace } = await podDirectories(this.store.root, ids.get(pod.key)!)
        for (const path of pod.assets) {
          const target = join(workspace, path)
          await writePrivate(target, files.get(path)!); assets.set(`${pod.key}/${path}`, target)
        }
        await syncTree(join(this.store.root, 'pods', ids.get(pod.key)!))
      }
      await syncDirectory(join(this.store.root, 'pods'))
      observe('staged')
      this.store.transaction(() => {
        this.required(id, expectedRevision)
        if (this.store.listPods().length + manifest.pods.length > 100) throw new Error('Local pod limit reached')
        for (const pod of manifest.pods) {
          const created = this.store.createPod({ name: clip(pod.title) }, ids.get(pod.key)!)
          const draftId = drafts[pod.key] = randomUUID()
          // Tool capabilities name local resources and are added when the recipient binds them.
          const capabilities = pod.requestedCapabilities.filter(capability => !capability.startsWith('tool.'))
          this.store.db.prepare('INSERT INTO script_drafts VALUES(?,?,1,?,?,?,NULL,NULL)').run(draftId, created.id, created.bindingRevision, decoder.decode(files.get(pod.script)!), JSON.stringify(capabilities))
          const packages = prepared[pod.key] = pod.packages ? parsePackages(JSON.parse(decoder.decode(files.get(pod.packages.manifest)!))) : { dependencies: {} }
          this.store.db.prepare('INSERT INTO draft_packages VALUES(?,?)').run(draftId, JSON.stringify(packages))
          for (const binding of pod.bindings) {
            const input = pod.inputs.find(item => item.key === binding.input)!
            const value = scalarKinds.includes(input.kind) ? resolved(values, 'pods', pod.key, input) : undefined
            if (value !== undefined) new PodVariables(this.store).save(created.id, binding.alias, String(value), 0)
          }
          for (const path of pod.assets) this.resources.alias(created.id, path, this.resources.assignReference(created.id, path, assets.get(`${pod.key}/${path}`)!).id)
        }
        this.advance(id, 'state=\'committed\',setup=?', JSON.stringify({ ...setup, drafts, packages: prepared }))
        observe('beforeCommit')
      })
    }
    catch (error) {
      // A refused or raced commit must not leave files of Pods that were never created.
      for (const podId of ids.values()) {
        if (!this.store.db.prepare('SELECT 1 FROM pods WHERE id=?').get(podId)) await rm(join(this.store.root, 'pods', podId), { recursive: true, force: true })
      }
      throw error
    }
    finally { committing.delete(id) }
    observe('committed')
    return this.view(id)
  }

  // Records which local assignment the recipient chose for a declared alias and names its capability in the imported draft.
  bind(id: string, expectedRevision: number, podKey: string, alias: string, resourceId: string, bundle: { identity: string, executableHash: string } | null): PortableImportView {
    return this.store.transaction(() => {
      const row = this.required(id, expectedRevision); const manifest = JSON.parse(row.manifest as string) as PortableManifest
      const setup = JSON.parse(row.setup as string) as ImportSetup
      const pod = manifest.pods.find(item => item.key === podKey); const podId = this.pods(id).find(item => item.key === podKey)?.podId
      // A later reassignment creates a new local resource, so the owner can bind an alias again after setup.
      if ((row.state !== 'committed' && row.state !== 'completed') || !pod || !podId || !this.store.db.prepare('SELECT 1 FROM pods WHERE id=?').get(podId)) throw new Error('Bindings require the paused copy of a declared package Pod')
      const declared = pod.applications.some(item => item.alias === alias) || pod.access.some(item => item.alias === alias && (item.kind === 'directory' || item.kind === 'http'))
      const resource = this.resources.list(podId).find(item => item.id === resourceId)
      const variables = new PodVariables(this.store).values(podId)
      if (!declared || !satisfies(manifest, pod, alias, resource, key => inputValue(pod, setup.values, variables, key), bundle)) throw new Error('This assignment does not match the declared package access')
      const previous = this.resources.aliases(podId).find(item => item.alias === alias)?.resource.configuration.capability
      this.resources.alias(podId, alias, resourceId)
      const bundles = { ...setup.bundles, [podKey]: { ...setup.bundles?.[podKey] } }
      if (resource!.configuration.bundlePath) bundles[podKey]![alias] = bundle!.executableHash
      else delete bundles[podKey]![alias]
      const draft = this.store.db.prepare('SELECT capabilities FROM script_drafts WHERE id=? AND pod_id=?').get(setup.drafts?.[podKey] ?? '', podId)
      const capability = resource!.configuration.capability
      // Only a tool capability the package requested for this alias is named in the imported draft.
      if (draft && typeof capability === 'string' && pod.requestedCapabilities.some(item => item === `tool.${alias}.invoke` || item === `tool.${alias}.request`)) {
        const shared = this.resources.aliases(podId).some(item => item.resource.configuration.capability === previous)
        const capabilities = [...(JSON.parse(draft.capabilities as string) as string[]).filter(item => (item !== previous || shared) && item !== capability), capability]
        this.store.db.prepare('UPDATE script_drafts SET capabilities=?,revision=revision+1,validation=NULL,script_hash=NULL WHERE id=?').run(JSON.stringify(capabilities), setup.drafts![podKey]!)
      }
      this.advance(id, 'setup=?', JSON.stringify({ ...setup, bundles }))
      return this.view(id)
    })
  }

  // Installs exactly the imported dependency lock; npm never resolves a fresh tree for an imported draft.
  async prepareDependencies(id: string, podKey: string, runtime: ScriptRuntime, signal: AbortSignal): Promise<PortableImportView> {
    const row = this.required(id); const podId = this.pods(id).find(item => item.key === podKey)?.podId
    if (row.state !== 'committed' || !podId) throw new Error('Dependencies are prepared for the paused copy of a declared package Pod')
    if (!row.archive_hash) throw new Error(String(row.error ?? 'Import the package again'))
    const { manifest, files } = await readPortableArchive(this.store.readBlob(row.archive_hash as string), this.npmRoot, importFormatFeatures)
    const pod = manifest.pods.find(item => item.key === podKey)!
    if (!pod.packages) return this.view(id)
    const current = () => { signal.throwIfAborted(); if (this.required(id).state !== 'committed' || this.store.getPod(podId).lifecycle === 'archived') throw new Error('Import changed while preparing dependencies') }
    await new DependencyStore(this.store).prepare(runtime, podId, parsePackages(JSON.parse(decoder.decode(files.get(pod.packages.manifest)!))), signal, current, decoder.decode(files.get(pod.packages.lock)!))
    return this.view(id)
  }

  private async apply(command: PortableImportCommand, runtime: ScriptRuntime, signal: AbortSignal, engines: ImportEngines): Promise<PortableImportView | undefined> {
    if (command.type === 'list' || command.type === 'inspect') return undefined
    if (command.type === 'show') return this.view(command.id)
    if (command.type === 'stage') return this.stage(command.id, command.archive)
    if (command.type === 'configure') return this.configure(command.id, command.revision, command.values)
    if (command.type === 'commit') return this.commit(command.id, command.revision)
    if (command.type === 'bind') return this.bind(command.id, command.revision, command.pod, command.alias, command.resourceId, command.bundle)
    if (command.type === 'prepareDependencies') return this.prepareDependencies(command.id, command.pod, runtime, signal)
    if (command.type === 'finalize') return this.finalize(command.id, command.revision, command.composition, command.groupId, command.reuse, engines)
    return this[command.type](command.id, command.revision)
  }

  async execute(command: PortableImportCommand, runtime: ScriptRuntime, signal: AbortSignal, engines: ImportEngines): Promise<PortableImportState> {
    const current = await this.apply(command, runtime, signal, engines)
    return { imports: this.list(), ...(current ? { current } : {}), ...(command.type === 'inspect' ? { inspected: await this.inspect(command.archive) } : {}) }
  }

  // Creates an imported composition from its package document. Sequences and channel graphs are created disabled during setup;
  // networks, called workflows and mail policies need approved member scripts and follow completed Pod setup.
  async finalize(id: string, expectedRevision: number, key: string, groupId: string | null, reuse: Record<string, string>, engines: ImportEngines): Promise<PortableImportView> {
    const row = this.required(id)
    if (this.view(id).compositions.some(item => item.key === key)) return this.view(id)
    const setup = JSON.parse(row.setup as string) as ImportSetup
    if (!['committed', 'completed'].includes(String(row.state)) || row.revision !== expectedRevision) throw new Error('Import changed; reload before continuing')
    if (setup.deferred?.includes(key) && row.state !== 'completed') throw new Error('Finish Pod setup and approve the member scripts before creating this composition')
    if (!row.archive_hash) throw new Error(String(row.error ?? 'Import the package again'))
    const { manifest, files } = await readPortableArchive(this.store.readBlob(row.archive_hash as string), this.npmRoot, importFormatFeatures)
    const composition = manifest.compositions.find(item => item.key === key)
    if (!composition) throw new Error('Unknown package composition')
    const document = JSON.parse(decoder.decode(files.get(composition.document)!)) as CompositionDocument
    const ids = new Map(this.pods(id).map(item => [item.key, item.podId]))
    const context: CompositionContext = {
      store: this.store, resources: this.resources, owner: this.owner, manifest,
      podId: (podKey) => {
        const podId = ids.get(podKey)
        if (!podId || !this.store.db.prepare('SELECT 1 FROM pods WHERE id=?').get(podId)) throw new Error('A member Pod of this composition no longer exists')
        return podId
      },
      value: (compositionKey, input) => {
        const declaration = manifest.compositions.find(item => item.key === compositionKey)!.inputs.find(item => item.key === input)!
        const item = resolved(setup.values, 'compositions', compositionKey, declaration)
        if (item === undefined) throw new Error('Import setup is incomplete')
        return item
      },
      workflowId: compositionKey => setup.compositions?.[compositionKey]?.workflowId,
    }
    const deferred = setup.deferred?.includes(key) ?? false
    if (composition.kind === 'network') {
      if (!groupId) throw new Error('A persistent network needs an existing group')
      await finalizeNetwork(context, engines, composition, document, files, groupId, reuse, (networkId) => { this.required(id, expectedRevision); this.record(id, key, { networkId }) })
      return this.view(id)
    }
    // Deferred workflows (ports, mail policy, call targets) need approved members; a called workflow lives in the group of its caller.
    if (deferred) {
      for (const node of composition.nodes) assertApproved(context, manifest.pods.find(item => item.key === node.pod)!)
    }
    const called = manifest.compositions.some(item => item.calls.includes(key))
    return this.store.transaction(() => {
      this.required(id, expectedRevision)
      if (composition.kind === 'channels' || called ? !groupId || !this.store.db.prepare('SELECT 1 FROM pod_groups WHERE id=?').get(groupId) : groupId !== null) throw new Error('A channel graph or called workflow needs an existing group; a plain sequence has none')
      const workflowId = randomUUID()
      // The suggested schedule is kept for review; the workflow stays disabled until the owner enables it.
      const command = workflowCommand(context, composition, document, workflowId, groupId)
      if (groupId) { if (deferred) assertFreshMembers(context, composition); joinGroup(this.store, command.nodes.map(node => node.podId), groupId) }
      engines.workflows.save({ ...command, ...(composition.kind === 'sequence' && groupId ? { groupId } : {}) })
      return this.record(id, key, { workflowId })
    })
  }

  // Records a created composition; once a completed import has nothing left to create, its archive is released.
  private record(id: string, key: string, created: { workflowId?: string, networkId?: string }): PortableImportView {
    const row = this.required(id); const setup = JSON.parse(row.setup as string) as ImportSetup
    this.advance(id, 'setup=?', JSON.stringify({ ...setup, compositions: { ...setup.compositions, [key]: created } }))
    if (row.state === 'completed' && !this.view(id).unresolved.length) this.advance(id, 'archive_hash=NULL')
    return this.view(id)
  }

  complete(id: string, expectedRevision: number): PortableImportView {
    return this.store.transaction(() => {
      const row = this.required(id)
      if (row.state === 'completed') return this.view(id)
      if (row.state !== 'committed' || row.revision !== expectedRevision) throw new Error('Import changed; reload before finishing setup')
      // Compositions that need approved member scripts are created after completion.
      const deferred = (JSON.parse(row.setup as string) as ImportSetup).deferred ?? []
      const view = this.view(id)
      if (view.unresolved.some(item => item.scope !== 'composition' || !deferred.includes(item.key))) throw new Error('Import setup is incomplete')
      // The archive still holds the documents of compositions created after completion.
      this.advance(id, view.unresolved.length ? 'state=\'completed\',error=NULL' : 'state=\'completed\',archive_hash=NULL,error=NULL')
      return this.view(id)
    })
  }

  // Only a pending import can be cancelled. A created copy consists of ordinary paused Pods the owner deletes through the reviewed path.
  cancel(id: string, expectedRevision: number): PortableImportView {
    return this.store.transaction(() => {
      const row = this.required(id)
      if (row.state === 'cancelled') return this.view(id)
      if (row.revision !== expectedRevision || committing.has(id)) throw new Error('Import changed; reload before continuing')
      // After completion, cancel only abandons compositions not created yet and releases the archive; Pods and created compositions stay.
      if (row.state === 'completed') {
        const setup = JSON.parse(row.setup as string) as ImportSetup
        this.advance(id, 'setup=?,archive_hash=NULL', JSON.stringify({ ...setup, deferred: [] }))
        return this.view(id)
      }
      if (row.state !== 'staged') throw new Error('The paused copy already exists; archive and delete its Pods individually')
      this.store.db.prepare('DELETE FROM portable_import_pods WHERE import_id=?').run(id)
      this.advance(id, 'state=\'cancelled\',archive_hash=NULL')
      return this.view(id)
    })
  }
}

// Journals whose Pods the owner deleted, and cancelled ones, carry nothing to resume.
function forgetFinishedImports(store: PodDatabase): void {
  store.db.exec('DELETE FROM portable_import_pods WHERE import_id IN (SELECT id FROM portable_imports WHERE state IN (\'committed\',\'completed\')) AND pod_id NOT IN (SELECT id FROM pods)')
  store.db.exec('DELETE FROM portable_imports WHERE state!=\'staged\' AND id NOT IN (SELECT import_id FROM portable_import_pods)')
}

// Startup recovery: a staged import never has Pods, so files under its recorded identities are leftovers of an interrupted commit.
export async function recoverPortableImports(store: PodDatabase): Promise<void> {
  for (const row of store.db.prepare('SELECT pod_id FROM portable_import_pods p JOIN portable_imports i ON i.id=p.import_id WHERE i.state=\'staged\'').all()) await rm(join(store.root, 'pods', row.pod_id as string), { recursive: true, force: true })
  store.transaction(() => forgetFinishedImports(store))
}
