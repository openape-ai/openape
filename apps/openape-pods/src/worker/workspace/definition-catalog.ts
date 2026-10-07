import { randomUUID } from 'node:crypto'
import { parseOwner } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { canonicalNetworkJson } from '../../contracts/network-json'
import { definitionDefaults } from '../../contracts/definitions'
import type { DefinitionVersionView, DefinitionView } from '../../contracts/definitions'
import { emptyPackages, parsePackages } from '../../contracts/dependencies'
import { parseGraphContract } from '../../contracts/graphs'
import { DependencyStore } from '../dependencies/store'
import { digest, parseManifest } from '../storage/database'
import type { PodDatabase, ScriptManifest } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'

export class DefinitionCatalog {
  readonly owner: Owner
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, owner: Owner) { this.owner = parseOwner(owner) }

  private ownsPod(podId: string): boolean {
    const row = this.store.db.prepare('SELECT owner FROM remote_pods WHERE pod_id=?').get(podId)
    if (row) {
      const owner = parseOwner(JSON.parse(row.owner as string))
      if (owner.issuer !== this.owner.issuer || owner.subject !== this.owner.subject) return false
    }
    const definition = this.store.db.prepare('SELECT d.owner_issuer,d.owner_subject FROM instance_definition_bindings b JOIN pod_definitions d ON d.id=b.definition_id WHERE b.pod_id=?').get(podId)
    if (definition && (definition.owner_issuer !== this.owner.issuer || definition.owner_subject !== this.owner.subject)) return false
    return true
  }

  assertPod(podId: string): void {
    this.store.getPod(podId)
    if (!this.ownsPod(podId)) throw new Error('Pod or definition belongs to another owner')
  }

  assertDefinition(id: string): void {
    if (!this.store.db.prepare('SELECT 1 FROM pod_definitions WHERE id=? AND owner_issuer=? AND owner_subject=?').get(id, this.owner.issuer, this.owner.subject)) throw new Error('Definition is not assigned to this owner')
  }

  source(id: string, version: number) {
    this.assertDefinition(id)
    const row = this.store.db.prepare(`SELECT v.*,s.state,s.source_pod_id,s.manifest,s.packages,s.dependency_hash FROM pod_definition_versions v
      LEFT JOIN pod_definition_sources s ON s.definition_id=v.definition_id AND s.version=v.version WHERE v.definition_id=? AND v.version=?`).get(id, version)
    if (!row) throw new Error('Definition version not found')
    const manifest = row.manifest ? parseManifest(JSON.parse(row.manifest as string)) : null
    const view: DefinitionVersionView = {
      version, state: row.state === 'published' ? 'published' : 'legacy', contentHash: row.content_hash as string, lockHash: row.lock_hash as string,
      contract: manifest?.contract ? parseGraphContract(manifest.contract) : null,
      capabilities: manifest?.capabilities ?? [], packages: row.packages ? parsePackages(JSON.parse(row.packages as string)) : emptyPackages(),
      defaults: definitionDefaults(Object.fromEntries(this.store.db.prepare('SELECT name,value FROM definition_config WHERE definition_id=? AND definition_version=? AND kind=\'public\'').all(id, version).map(item => [item.name as string, JSON.parse(item.value as string)]))),
    }
    if (manifest && (manifest.contentHash !== view.contentHash || manifest.dependencyLockHash !== view.lockHash)) throw new Error('Definition manifest does not match its version')
    return { view, manifest, sourcePodId: row.source_pod_id as string | null, dependencyHash: row.dependency_hash as string | null }
  }

  list(): DefinitionView[] {
    return this.store.db.prepare('SELECT id,name FROM pod_definitions WHERE owner_issuer=? AND owner_subject=? ORDER BY created_at,id').all(this.owner.issuer, this.owner.subject).map(row => ({
      id: row.id as string, name: row.name as string,
      versions: this.store.db.prepare('SELECT version FROM pod_definition_versions WHERE definition_id=? ORDER BY version').all(row.id!).map(version => this.source(row.id as string, version.version as number).view),
    }))
  }

  adopt(podId?: string): void {
    this.store.transaction(() => {
      this.store.db.prepare('INSERT OR IGNORE INTO network_owners VALUES(?,?)').run(this.owner.issuer, this.owner.subject)
      for (const pod of podId ? [this.store.getPod(podId)] : this.store.listPods()) {
        if (!podId && !this.ownsPod(pod.id)) continue
        this.assertPod(pod.id)
        if (this.store.db.prepare('SELECT 1 FROM instance_definition_bindings WHERE pod_id=?').get(pod.id)) continue
        const row = pod.activeScript ? this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(pod.id, pod.activeScript) : undefined
        const manifest = row ? parseManifest(JSON.parse(row.manifest as string)) : null
        if (manifest) this.store.readBlob(manifest.contentHash)
        const id = randomUUID()
        this.store.db.prepare('INSERT INTO pod_definitions VALUES(?,?,?,?,?)').run(id, this.owner.issuer, this.owner.subject, pod.name, Date.now())
        this.insertVersion(id, 1, pod.id, manifest, 'legacy', {})
        this.store.db.prepare('INSERT INTO instance_definition_bindings VALUES(?,?,1,1)').run(pod.id, id)
      }
    })
  }

  async publish(podId: string, expectedScript: string, name: string, defaults: Record<string, unknown>, localUpdate?: (apply: () => void) => void): Promise<void> {
    const state = localUpdate ? 'legacy' : 'published'
    const current = () => {
      this.assertPod(podId)
      const pod = this.store.getPod(podId)
      if (localUpdate && pod.lifecycle !== 'paused') throw new Error('Pause this instance before preparing its local definition')
      if (pod.lifecycle === 'archived' || pod.activeScript !== expectedScript) throw new Error('Active script changed; review publication again')
      if (!this.store.db.prepare('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(podId, expectedScript, pod.bindingRevision, this.resources.epoch(podId))) throw new Error('Validate the current instance before publishing its definition')
      const row = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, expectedScript)
      if (!row) throw new Error('Script version is missing')
      const manifest = parseManifest(JSON.parse(row.manifest as string))
      if (!localUpdate && manifest.capabilities.some(capability => /^tool\.(?:http|ssh|app)_[a-f0-9]{32}\./.test(capability))) throw new Error('This script uses instance-specific HTTP, SSH or program rights. Keep it local until its resource bindings can be reviewed for reuse.')
      if (manifest.assignmentRevision !== pod.bindingRevision) throw new Error('Script binding changed')
      if (this.store.readBlob(expectedScript).length > 200000) throw new Error('Definition source exceeds the publication limit')
      return manifest
    }
    current()
    const dependencies = new DependencyStore(this.store)
    const dependencyHash = dependencies.scriptSet(podId, expectedScript)
    if (dependencyHash) await dependencies.verify(podId, dependencyHash)
    const apply = () => this.store.transaction(() => {
      const manifest = current()
      this.adopt(podId)
      const binding = this.store.db.prepare('SELECT definition_id,definition_version FROM instance_definition_bindings WHERE pod_id=?').get(podId)!
      const id = binding.definition_id as string
      if (localUpdate && (this.source(id, Number(binding.definition_version)).sourcePodId !== podId || this.store.db.prepare('SELECT 1 FROM instance_definition_bindings WHERE definition_id=? AND pod_id!=?').get(id, podId))) {
        const localId = randomUUID()
        this.store.db.prepare('INSERT INTO pod_definitions VALUES(?,?,?,?,?)').run(localId, this.owner.issuer, this.owner.subject, name, Date.now())
        this.insertVersion(localId, 1, podId, manifest, 'legacy', defaults)
        this.store.db.prepare('UPDATE instance_definition_bindings SET definition_id=?,definition_version=1,binding_revision=binding_revision+1 WHERE pod_id=?').run(localId, podId)
        return
      }
      const version = Number(this.store.db.prepare('SELECT max(version) AS version FROM pod_definition_versions WHERE definition_id=?').get(id)!.version) + 1
      const previous = this.source(id, version - 1)
      const unchanged = previous.view.state === state && previous.view.contentHash === expectedScript && previous.view.lockHash === manifest.dependencyLockHash && canonicalNetworkJson(previous.view.defaults) === canonicalNetworkJson(definitionDefaults(defaults)) && this.store.db.prepare('SELECT name FROM pod_definitions WHERE id=?').get(id)!.name === name
      if (!unchanged) {
        if (version > 1000) throw new Error('Definition version limit reached')
        this.insertVersion(id, version, podId, manifest, state, defaults)
        this.store.db.prepare('UPDATE pod_definitions SET name=? WHERE id=?').run(name, id)
      }
      if (localUpdate) {
        const selectedVersion = unchanged ? version - 1 : version
        this.store.db.prepare('UPDATE instance_definition_bindings SET definition_version=?,binding_revision=binding_revision+1 WHERE pod_id=? AND definition_version<>?').run(selectedVersion, podId, selectedVersion)
      }
    })
    if (localUpdate) localUpdate(apply)
    else apply()
  }

  // Member script updates stay local: a definition shared with other instances is forked, and versions are never published from here.
  appendScriptVersion(podId: string, manifest: ScriptManifest): void {
    this.assertPod(podId)
    const binding = this.store.db.prepare('SELECT definition_id,definition_version FROM instance_definition_bindings WHERE pod_id=?').get(podId)
    if (!binding) throw new Error('Adopt the existing instance before updating its script')
    if (this.store.readBlob(manifest.contentHash).length > 200000) throw new Error('Definition source exceeds the publication limit')
    const id = binding.definition_id as string
    const current = this.source(id, binding.definition_version as number)
    if (current.sourcePodId !== podId || this.store.db.prepare('SELECT 1 FROM instance_definition_bindings WHERE definition_id=? AND pod_id!=?').get(id, podId)) {
      const localId = randomUUID()
      this.store.db.prepare('INSERT INTO pod_definitions VALUES(?,?,?,?,?)').run(localId, this.owner.issuer, this.owner.subject, this.store.db.prepare('SELECT name FROM pod_definitions WHERE id=?').get(id)!.name as string, Date.now())
      this.insertVersion(localId, 1, podId, manifest, 'legacy', current.view.defaults)
      this.store.db.prepare('UPDATE instance_definition_bindings SET definition_id=?,definition_version=1,binding_revision=binding_revision+1 WHERE pod_id=?').run(localId, podId)
      return
    }
    const version = Number(this.store.db.prepare('SELECT max(version) AS version FROM pod_definition_versions WHERE definition_id=?').get(id)!.version) + 1
    if (version > 1000) throw new Error('Definition version limit reached')
    this.insertVersion(id, version, podId, manifest, 'legacy', current.view.defaults)
    this.store.db.prepare('UPDATE instance_definition_bindings SET definition_version=?,binding_revision=binding_revision+1 WHERE pod_id=?').run(version, podId)
  }

  private insertVersion(id: string, version: number, podId: string, manifest: ScriptManifest | null, state: 'legacy' | 'published', defaults: Record<string, unknown>): void {
    const values = definitionDefaults(defaults)
    const packages = manifest ? new DependencyStore(this.store).scriptManifest(podId, manifest.contentHash) : emptyPackages()
    this.store.db.prepare('INSERT INTO pod_definition_versions VALUES(?,?,?,?,?,?)').run(id, version, manifest?.contentHash ?? this.store.putBlob(''), manifest?.dependencyLockHash ?? digest(''), canonicalNetworkJson(manifest?.contract ?? {}), Date.now())
    this.store.db.prepare('INSERT INTO pod_definition_sources VALUES(?,?,?,?,?,?,?)').run(id, version, state, podId, manifest ? JSON.stringify(manifest) : null, JSON.stringify(packages), manifest ? new DependencyStore(this.store).scriptSet(podId, manifest.contentHash) : null)
    for (const [name, value] of Object.entries(values)) this.store.db.prepare('INSERT INTO definition_config(definition_id,definition_version,name,kind,value) VALUES(?,?,?,?,?)').run(id, version, name, 'public', canonicalNetworkJson(value))
  }
}
