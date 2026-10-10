import { randomUUID } from 'node:crypto'
import type { Owner } from '@openape/pods-protocol'
import { parseDefinitionCommand } from '../../contracts/definitions'
import type { DefinitionsView, DefinitionUpdateView } from '../../contracts/definitions'
import { canonicalNetworkJson } from '../../contracts/network-json'
import { podDirectories } from '../../runtime/environment'
import { assertDataIdle } from '../data/backup'
import { DependencyStore } from '../dependencies/store'
import { digest, parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import { DefinitionCatalog } from './definition-catalog'
import { WorkspaceDetails } from './details'

// A definition change binds one Pod. The scheduler is held in maintenance meanwhile, network members are
// settled by the network engine, and work of unrelated Pods neither reads nor changes this binding.
function assertPodIdle(store: PodDatabase, podId: string): void {
  if (store.db.prepare('SELECT 1 FROM dependency_domains LIMIT 1').get()) throw new Error('Finish dependency preparation before changing application data')
  const run = store.db.prepare('SELECT run_id FROM run_leases WHERE pod_id=?').get(podId)
  if (run) throw new Error(`Run ${String(run.run_id)} of this Pod is still active. Wait until it ends, or cancel or recover it (recovery list, then recover or cancel), before changing its definition.`)
  if (store.db.prepare('SELECT 1 FROM program_leases WHERE pod_id=?').get(podId)) throw new Error('Close the application terminal of this Pod before changing its definition')
}

export class DefinitionWorkspace {
  private readonly catalog: DefinitionCatalog
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, owner: Owner, private readonly updateNetworkInstance?: (podId: string, update: () => void) => void) { this.catalog = new DefinitionCatalog(store, resources, owner) }

  async execute(input: unknown, signal: AbortSignal): Promise<DefinitionsView> {
    const command = parseDefinitionCommand(input)
    if (command.type === 'list') return this.view()
    if ('podId' in command) assertPodIdle(this.store, command.podId)
    else assertDataIdle(this.store)
    signal.throwIfAborted()
    if (command.type === 'adopt') this.catalog.adopt()
    if (command.type === 'publish') await this.catalog.publish(command.podId, command.expectedScript, command.name, command.defaults)
    if (command.type === 'prepareLocal') {
      await this.catalog.publish(command.podId, command.expectedScript, command.name, command.defaults, (apply) => {
        if (this.updateNetworkInstance) {
          this.updateNetworkInstance(command.podId, apply)
        }
        else {
          if (this.store.db.prepare('SELECT 1 FROM network_members WHERE pod_id=?').get(command.podId)) throw new Error('Network compatibility review is unavailable; current version remains pinned')
          apply()
        }
      })
    }
    if (command.type === 'instantiate') {
      const requestHash = digest(canonicalNetworkJson(command))
      const podId = this.store.transaction(() => {
        const existing = this.request(command.requestId)
        if (existing) {
          if (existing.request_hash !== requestHash) throw new Error('Instance request was reused with different values')
          return existing.pod_id as string
        }
        const source = this.catalog.source(command.definitionId, command.version)
        if (source.view.state !== 'published') throw new Error('Publish this definition before creating an instance')
        if (!this.store.db.prepare('SELECT 1 FROM pod_groups WHERE id=?').get(command.groupId)) throw new Error('Company group no longer exists')
        if (this.store.listPods().length >= 100) throw new Error('Local pod limit reached')
        const pod = this.store.createPod({ name: command.name })
        this.store.db.prepare('INSERT INTO pod_memberships VALUES(?,?)').run(pod.id, command.groupId)
        this.store.db.prepare('UPDATE pod_organization SET revision=revision+1 WHERE id=1').run()
        this.store.db.prepare('INSERT INTO instance_definition_bindings VALUES(?,?,?,1)').run(pod.id, command.definitionId, command.version)
        const owner = this.catalog.owner
        this.store.db.prepare('INSERT INTO definition_instance_requests VALUES(?,?,?,?,?,?,?,\'pending\',NULL,?)').run(command.requestId, requestHash, pod.id, command.definitionId, command.version, owner.issuer, owner.subject, Date.now())
        return pod.id
      })
      await this.prepareInstance(command.requestId, podId, signal)
      return { ...this.view(), createdPodId: podId }
    }
    if (command.type === 'retryProvision') {
      const request = this.request(command.requestId)
      if (!request) throw new Error('Instance request not found')
      await this.prepareInstance(command.requestId, request.pod_id as string, signal)
      return { ...this.view(), createdPodId: request.pod_id as string }
    }
    if (command.type === 'previewUpdate' || command.type === 'prepareUpdate') {
      const update = this.preview(command.podId, command.definitionId, command.version, command.expectedBinding)
      if (command.type === 'prepareUpdate') update.draftId = await this.prepare(command.podId, command.definitionId, command.version, command.expectedBinding, signal)
      return { ...this.view(), update }
    }
    if (command.type === 'activateUpdate') this.activate(command.podId, command.draftId, command.expectedBinding)
    return this.view()
  }

  private request(id: string) {
    const row = this.store.db.prepare('SELECT * FROM definition_instance_requests WHERE id=?').get(id)
    if (row && (row.owner_issuer !== this.catalog.owner.issuer || row.owner_subject !== this.catalog.owner.subject)) throw new Error('Instance request belongs to another owner')
    return row
  }

  provisioned(requestId: string, error: string | null): DefinitionsView {
    const row = this.request(requestId)
    if (!row) throw new Error('Instance request not found')
    if (!error) {
      this.catalog.assertPod(row.pod_id as string)
      const identity = this.store.db.prepare('SELECT phase,identity FROM remote_pods WHERE pod_id=?').get(row.pod_id!)
      if (identity?.phase !== 'ready' || !identity.identity) throw new Error('Instance identity is not ready; keep the existing request for retry')
    }
    if (row.state === 'ready' && error) throw new Error('Ready identity cannot be replaced by a failed retry')
    this.store.db.prepare('UPDATE definition_instance_requests SET state=?,error=? WHERE id=?').run(error ? 'failed' : 'ready', error?.slice(0, 2000) ?? null, requestId)
    return this.view()
  }

  private async prepareInstance(requestId: string, podId: string, signal: AbortSignal): Promise<void> {
    const request = this.request(requestId)!
    if (request.state === 'ready') return
    try {
      this.catalog.assertPod(podId)
      signal.throwIfAborted()
      const identity = this.store.db.prepare('SELECT phase,identity FROM remote_pods WHERE pod_id=?').get(podId)
      if (identity?.phase === 'needs_desktop_action') throw new Error('Recover this existing identity on desktop before retrying. A restored identity must never be provisioned again.')
      if (identity?.phase === 'ready' && identity.identity) { this.provisioned(requestId, null); return }
      await podDirectories(this.store.root, podId)
      const binding = this.binding(podId)
      const existing = this.store.db.prepare('SELECT 1 FROM definition_update_drafts WHERE pod_id=? AND definition_id=? AND definition_version=?').get(podId, binding.definition_id!, binding.definition_version!)
      if (!existing && !this.store.getPod(podId).activeScript) await this.prepare(podId, binding.definition_id as string, binding.definition_version as number, binding.binding_revision as number, signal)
      this.store.db.prepare('UPDATE definition_instance_requests SET state=\'pending\',error=NULL WHERE id=?').run(requestId)
    }
    catch (error) { this.provisioned(requestId, error instanceof Error ? error.message : String(error)); throw error }
  }

  private binding(podId: string) {
    this.catalog.assertPod(podId)
    const row = this.store.db.prepare('SELECT * FROM instance_definition_bindings WHERE pod_id=?').get(podId)
    if (!row) throw new Error('Adopt the existing instance before updating its definition')
    return row
  }

  private preview(podId: string, id: string, version: number, revision: number): DefinitionUpdateView {
    const binding = this.binding(podId)
    if (binding.binding_revision !== revision || binding.definition_id !== id) throw new Error('Instance definition binding changed; reload')
    const selected = this.catalog.source(id, binding.definition_version as number).view
    const pod = this.store.getPod(podId)
    const row = pod.activeScript ? this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, pod.activeScript) : undefined
    const manifest = row ? parseManifest(JSON.parse(row.manifest as string)) : null
    const beforeCode = pod.activeScript ? this.store.readBlob(pod.activeScript).toString('utf8') : ''
    const before = { ...selected, contentHash: manifest?.contentHash ?? digest(''), lockHash: manifest?.dependencyLockHash ?? digest(''), contract: manifest?.contract ?? null, capabilities: manifest?.capabilities ?? [], packages: new DependencyStore(this.store).scriptManifest(podId, pod.activeScript ?? '') }
    const after = this.catalog.source(id, version).view
    const afterCode = this.store.readBlob(after.contentHash).toString('utf8')
    if (beforeCode.length > 200000 || afterCode.length > 200000) throw new Error('Definition source exceeds the review limit')
    if (after.state !== 'published') throw new Error('Only published versions can be selected')
    const changed: DefinitionUpdateView['changed'] = []
    if (before.contentHash !== after.contentHash) changed.push('code')
    if (canonicalNetworkJson(before.contract) !== canonicalNetworkJson(after.contract)) changed.push('contract')
    if (before.lockHash !== after.lockHash || canonicalNetworkJson(before.packages) !== canonicalNetworkJson(after.packages)) changed.push('dependencies')
    if (canonicalNetworkJson(before.defaults) !== canonicalNetworkJson(after.defaults)) changed.push('defaults')
    if (canonicalNetworkJson(before.capabilities) !== canonicalNetworkJson(after.capabilities)) changed.push('rights')
    return { podId, before, after, beforeCode, afterCode, changed }
  }

  private async prepare(podId: string, id: string, version: number, revision: number, signal: AbortSignal): Promise<string> {
    this.preview(podId, id, version, revision)
    const pod = this.store.getPod(podId)
    const current = () => {
      signal.throwIfAborted(); this.preview(podId, id, version, revision)
      const now = this.store.getPod(podId)
      if (now.lifecycle === 'archived' || now.activeScript !== pod.activeScript || now.bindingRevision !== pod.bindingRevision) throw new Error('Instance changed while preparing its definition')
    }
    current()
    const existing = this.store.db.prepare('SELECT draft_id FROM definition_update_drafts WHERE pod_id=? AND definition_id=? AND definition_version=? AND expected_binding=? AND expected_active IS ?').get(podId, id, version, revision, pod.activeScript)
    if (existing) return existing.draft_id as string
    const source = this.catalog.source(id, version)
    if (!source.manifest || !source.sourcePodId) throw new Error('Published definition source is missing')
    const dependencies = new DependencyStore(this.store)
    const hash = source.dependencyHash
    if (hash) await dependencies.copyPinned(source.sourcePodId, podId, hash, current)
    return this.store.transaction(() => {
      current()
      const draftId = randomUUID()
      this.store.db.prepare('INSERT INTO script_drafts VALUES(?,?,1,?,?,?,NULL,NULL)').run(draftId, podId, pod.bindingRevision, this.store.readBlob(source.view.contentHash).toString('utf8'), JSON.stringify(source.manifest!.capabilities))
      this.store.db.prepare('INSERT INTO draft_packages VALUES(?,?)').run(draftId, JSON.stringify(source.view.packages))
      this.store.db.prepare('INSERT INTO definition_update_drafts VALUES(?,?,?,?,?,?)').run(draftId, podId, id, version, revision, pod.activeScript)
      return draftId
    })
  }

  private activate(podId: string, draftId: string, revision: number): void {
    this.store.transaction(() => {
      this.binding(podId)
      const draft = this.store.db.prepare('SELECT * FROM definition_update_drafts WHERE draft_id=? AND pod_id=? AND expected_binding=?').get(draftId, podId, revision)
      if (!draft) throw new Error('Definition update draft changed; prepare it again')
      this.preview(podId, draft.definition_id as string, draft.definition_version as number, revision)
      const source = this.catalog.source(draft.definition_id as string, draft.definition_version as number)
      const validated = this.store.db.prepare('SELECT script_hash FROM script_drafts WHERE id=?').get(draftId)
      if (validated?.script_hash !== source.view.contentHash) throw new Error('Validate this instance against the selected definition before activation')
      if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=?').get(podId)) throw new Error('Wait for the active run to settle before updating its definition')
      if (this.store.db.prepare('SELECT 1 FROM workflow_reservations WHERE pod_id=?').get(podId)) throw new Error('Finish or cancel the reserved workflow before updating its instance')
      if (this.store.db.prepare('SELECT 1 FROM accepted_events WHERE pod_id=? AND state IN (\'pending\',\'claimed\',\'blocked\') UNION ALL SELECT 1 FROM effect_ledger WHERE pod_id=? AND state!=\'completed\' UNION ALL SELECT 1 FROM graph_gate_batches WHERE pod_id=? AND state IN (\'pending\',\'consuming\',\'unknown\') LIMIT 1').get(podId, podId, podId)) throw new Error('Resolve pending instance inputs, decisions and uncertain effects before selecting a new definition version')
      const update = () => {
        const pod = this.store.getPod(podId)
        new WorkspaceDetails(this.store, this.resources).execute({ type: 'activate', podId, hash: source.view.contentHash, expectedActive: draft.expected_active as string | null, assignmentRevision: pod.bindingRevision }, true)
        this.store.db.prepare('UPDATE instance_definition_bindings SET definition_version=?,binding_revision=binding_revision+1 WHERE pod_id=?').run(draft.definition_version!, podId)
        this.store.db.prepare('UPDATE pods SET lifecycle=\'paused\',metadata_revision=metadata_revision+1 WHERE id=?').run(podId)
      }
      if (this.updateNetworkInstance) {
        this.updateNetworkInstance(podId, update)
      }
      else {
        if (this.store.db.prepare('SELECT 1 FROM network_members WHERE pod_id=?').get(podId)) throw new Error('Network compatibility review is unavailable; current version remains pinned')
        update()
      }
    })
  }

  view(): DefinitionsView {
    const owner = this.catalog.owner
    const instances = this.store.db.prepare(`SELECT b.*,p.group_id FROM instance_definition_bindings b JOIN pod_definitions d ON d.id=b.definition_id LEFT JOIN pod_memberships p ON p.pod_id=b.pod_id WHERE d.owner_issuer=? AND d.owner_subject=?`).all(owner.issuer, owner.subject).map(row => ({ podId: row.pod_id as string, definitionId: row.definition_id as string, version: row.definition_version as number, bindingRevision: row.binding_revision as number, diverged: (this.store.getPod(row.pod_id as string).activeScript ?? digest('')) !== this.catalog.source(row.definition_id as string, row.definition_version as number).view.contentHash, groupId: row.group_id as string | null }))
    const provisioning = this.store.db.prepare('SELECT * FROM definition_instance_requests WHERE owner_issuer=? AND owner_subject=? ORDER BY created_at,id').all(owner.issuer, owner.subject).map(row => ({ requestId: row.id as string, podId: row.pod_id as string, state: row.state as 'pending' | 'ready' | 'failed', error: row.error as string | null }))
    return { definitions: this.catalog.list(), instances, provisioning }
  }
}
