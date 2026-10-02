import { randomUUID } from 'node:crypto'
import { mkdir, open, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseOwner } from '@openape/pods-protocol'
import type { Owner, PortableInput, PortableManifest } from '@openape/pods-protocol'
import { parsePackages } from '../../contracts/dependencies'
import { podDirectories } from '../../runtime/environment'
import { syncDirectory, syncTree } from '../data/files'
import type { ResourceRegistry } from '../resources/registry'
import { PodVariables } from '../resources/variables'
import type { CommitPoint, PodDatabase } from '../storage/database'
import { readPortableArchive } from './archive'

// Importer support only; the runtime does not advertise portable aliases as a script capability.
export const importFormatFeatures = ['portable_aliases_v1'] as const
export type PortableValue = string | number | boolean
export type PortableImportValues = Record<'pods' | 'compositions', Record<string, Record<string, PortableValue | null>>>
export interface PortableImportRequirement { scope: 'pod' | 'composition', key: string, input: string | null, requirement: 'value' | 'binding' | 'dependencies' | 'composition' }
export interface PortableImportView {
  id: string
  state: 'staged' | 'committed' | 'completed' | 'cancelled'
  revision: number
  transferSha256: string
  manifest: PortableManifest
  pods: { key: string, podId: string }[]
  values: PortableImportValues
  unresolved: PortableImportRequirement[]
  error: string | null
}

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

function unresolved(manifest: PortableManifest, values: PortableImportValues): PortableImportRequirement[] {
  const result: PortableImportRequirement[] = []
  for (const item of scopes(manifest)) {
    const scope = item.scope === 'pods' ? 'pod' : 'composition'
    for (const input of item.inputs) {
      if (!input.required) continue
      if (!scalarKinds.includes(input.kind)) result.push({ scope, key: item.key, input: input.key, requirement: 'binding' })
      else if (resolved(values, item.scope, item.key, input) === undefined) result.push({ scope, key: item.key, input: input.key, requirement: 'value' })
    }
  }
  for (const pod of manifest.pods) {
    if (pod.packages) result.push({ scope: 'pod', key: pod.key, input: null, requirement: 'dependencies' })
  }
  for (const composition of manifest.compositions) result.push({ scope: 'composition', key: composition.key, input: null, requirement: 'composition' })
  return result
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

  private advance(id: string, changes: string, ...values: (string | null)[]): void {
    this.store.db.prepare(`UPDATE portable_imports SET ${changes},revision=revision+1,updated_at=? WHERE id=?`).run(...values, Date.now(), id)
  }

  view(id: string): PortableImportView {
    const row = this.required(id); const manifest = JSON.parse(row.manifest as string) as PortableManifest
    const values = (JSON.parse(row.setup as string) as { values: PortableImportValues }).values
    // Once the copy exists, a Pod the owner deleted no longer needs setup.
    const pods = this.pods(id).filter(pod => row.state === 'staged' || this.store.db.prepare('SELECT 1 FROM pods WHERE id=?').get(pod.podId))
    const open = unresolved(manifest, values).filter(item => item.scope !== 'pod' || pods.some(pod => pod.key === item.key))
    return { id, state: row.state as PortableImportView['state'], revision: row.revision as number, transferSha256: row.transfer_hash as string, manifest, pods, values, unresolved: open, error: row.error as string | null }
  }

  list(): PortableImportView[] {
    this.store.transaction(() => forgetFinishedImports(this.store))
    return this.store.db.prepare('SELECT id FROM portable_imports WHERE owner_issuer=? AND owner_subject=? AND state IN (\'staged\',\'committed\') ORDER BY created_at').all(this.owner.issuer, this.owner.subject).map(row => this.view(row.id as string))
  }

  async inspect(archive: Uint8Array): Promise<{ manifest: PortableManifest, transferSha256: string }> {
    const { manifest, transferSha256 } = await readPortableArchive(archive, this.npmRoot, importFormatFeatures)
    return { manifest, transferSha256 }
  }

  async stage(id: string, archive: Uint8Array, observe: (point: CommitPoint) => void = () => {}): Promise<PortableImportView> {
    this.row(id)
    const bytes = Buffer.from(archive)
    const { manifest, transferSha256 } = await readPortableArchive(bytes, this.npmRoot, importFormatFeatures)
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
      this.store.db.prepare('INSERT INTO portable_imports VALUES(?,?,?,?,?,?,\'staged\',1,?,?,NULL,?,?)').run(id, this.owner.issuer, this.owner.subject, transferSha256, manifest.contentSha256, transferSha256, JSON.stringify(manifest), JSON.stringify({ values: { pods: {}, compositions: {} } }), now, now)
      for (const pod of manifest.pods) this.store.db.prepare('INSERT INTO portable_import_pods VALUES(?,?,?)').run(id, pod.key, randomUUID())
      observe('beforeCommit')
      return this.view(id)
    })
  }

  configure(id: string, expectedRevision: number, changes: PortableImportValues): PortableImportView {
    return this.store.transaction(() => {
      const row = this.required(id, expectedRevision)
      if (row.state !== 'staged') throw new Error('Values can only change before the paused copy is created')
      const manifest = JSON.parse(row.manifest as string) as PortableManifest
      const setup = JSON.parse(row.setup as string) as { values: PortableImportValues }
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
            for (const member of members) {
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
    committing.add(id)
    const ids = new Map(this.pods(id).map(item => [item.key, item.podId]))
    const values = (JSON.parse(row.setup as string) as { values: PortableImportValues }).values
    const { manifest, files } = await readPortableArchive(this.store.readBlob(row.archive_hash as string), this.npmRoot, importFormatFeatures)
    this.store.assertStorage(manifest.pods.flatMap(pod => pod.assets).reduce((total, path) => total + files.get(path)!.byteLength, 0))
    const assets = new Map<string, string>()
    try {
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
          const created = this.store.createPod({ name: [...pod.title].slice(0, 100).join('') }, ids.get(pod.key)!)
          const draftId = randomUUID()
          // Tool capabilities name local resources and are added when the recipient binds them.
          const capabilities = pod.requestedCapabilities.filter(capability => !capability.startsWith('tool.'))
          this.store.db.prepare('INSERT INTO script_drafts VALUES(?,?,1,?,?,?,NULL,NULL)').run(draftId, created.id, created.bindingRevision, decoder.decode(files.get(pod.script)!), JSON.stringify(capabilities))
          const packages = pod.packages ? parsePackages(JSON.parse(decoder.decode(files.get(pod.packages.manifest)!))) : { dependencies: {} }
          this.store.db.prepare('INSERT INTO draft_packages VALUES(?,?)').run(draftId, JSON.stringify(packages))
          for (const binding of pod.bindings) {
            const input = pod.inputs.find(item => item.key === binding.input)!
            const value = scalarKinds.includes(input.kind) ? resolved(values, 'pods', pod.key, input) : undefined
            if (value !== undefined) new PodVariables(this.store).save(created.id, binding.alias, String(value), 0)
          }
          for (const path of pod.assets) this.resources.assignReference(created.id, path, assets.get(`${pod.key}/${path}`)!)
        }
        this.advance(id, 'state=\'committed\'')
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

  complete(id: string, expectedRevision: number): PortableImportView {
    return this.store.transaction(() => {
      const row = this.required(id)
      if (row.state === 'completed') return this.view(id)
      if (row.state !== 'committed' || row.revision !== expectedRevision) throw new Error('Import changed; reload before finishing setup')
      if (this.view(id).unresolved.length) throw new Error('Import setup is incomplete')
      this.advance(id, 'state=\'completed\',archive_hash=NULL,error=NULL')
      return this.view(id)
    })
  }

  // Only a pending import can be cancelled. A created copy consists of ordinary paused Pods the owner deletes through the reviewed path.
  cancel(id: string, expectedRevision: number): PortableImportView {
    return this.store.transaction(() => {
      const row = this.required(id)
      if (row.state === 'cancelled') return this.view(id)
      if (row.state !== 'staged') throw new Error('The paused copy already exists; archive and delete its Pods individually')
      if (row.revision !== expectedRevision || committing.has(id)) throw new Error('Import changed; reload before continuing')
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
