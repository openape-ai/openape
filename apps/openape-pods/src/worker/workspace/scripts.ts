import { ScriptCredentials } from '../resources/script-credentials'
import { randomUUID } from 'node:crypto'
import type { ScriptCommand, ScriptSelection, ScriptSource, ScriptView } from '../../contracts/scripts'
import { parseScriptCommand } from '../../contracts/scripts'
import { parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import type { MasterControl } from '../master/control'
import { WorkspaceDetails } from './details'

export class ScriptWorkspace {
  private validating = false
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, private readonly control: MasterControl) {}

  async execute(value: ScriptCommand, signal: AbortSignal): Promise<ScriptView> {
    const command = parseScriptCommand(value)
    this.store.getPod(command.podId)
    if (command.type === 'list') return this.view(command.podId, command.selection)
    if (command.type === 'approveCredentials') {
      new ScriptCredentials(this.store, this.resources).approve(command.podId, command.hash, command.revision, command.epoch)
      return this.view(command.podId, { kind: 'version', id: command.hash })
    }
    const { type, ...fields } = command
    if (command.type === 'validate' && this.validating) throw new Error('Another script validation is running; try again when it finishes')
    if (command.type === 'validate') this.validating = true
    try {
      const result = await this.control.execute(`owner-script:${randomUUID()}`, { ...fields, action: type === 'save' ? 'draft' : type === 'activate' ? 'rollback' : 'validate' }, signal)
      const selection: ScriptSelection = command.type === 'activate' ? { kind: 'version', id: command.hash } : { kind: 'draft', id: command.type === 'save' ? (result as { draftId: string }).draftId : command.draftId }
      return this.view(command.podId, selection)
    }
    finally { if (command.type === 'validate') this.validating = false }
  }

  private evidence(podId: string, hash: string | null): string | null {
    if (!hash) return null
    const pod = this.store.getPod(podId)
    const row = this.store.db.prepare('SELECT evidence FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(podId, hash, pod.revision, this.resources.epoch(podId))
    return row ? row.evidence as string : null
  }

  private source(podId: string, selection: ScriptSelection): ScriptSource {
    if (selection.kind === 'version') {
      const row = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, selection.id)
      if (!row) throw new Error('Script version is not assigned to this pod')
      const manifest = parseManifest(JSON.parse(row.manifest as string))
      const evidence = this.evidence(podId, selection.id)
      return { ...selection, code: this.store.readBlob(selection.id).toString('utf8'), capabilities: manifest.capabilities, revision: 0, assignmentRevision: manifest.assignmentRevision, hash: selection.id, validated: evidence !== null, evidence, credentialAccessApproved: new ScriptCredentials(this.store, this.resources).approved(podId, selection.id) }
    }
    const row = this.store.db.prepare('SELECT * FROM script_drafts WHERE pod_id=? AND id=?').get(podId, selection.id)
    if (!row) throw new Error('Draft is not assigned to this pod')
    const evidence = this.evidence(podId, row.script_hash as string | null)
    return { ...selection, code: row.code as string, capabilities: JSON.parse(row.capabilities as string) as string[], revision: row.revision as number, assignmentRevision: row.assignment_revision as number, hash: row.script_hash as string | null, validated: evidence !== null, evidence, credentialAccessApproved: !!row.script_hash && new ScriptCredentials(this.store, this.resources).approved(podId, row.script_hash as string) }
  }

  private view(podId: string, selection?: ScriptSelection): ScriptView {
    const pod = this.store.getPod(podId)
    const versions = new WorkspaceDetails(this.store, this.resources).execute({ type: 'list', podId }).versions
    const drafts = this.store.db.prepare('SELECT id,revision,assignment_revision,script_hash FROM script_drafts WHERE pod_id=? ORDER BY rowid DESC LIMIT 100').all(podId).map(row => ({ id: row.id as string, revision: row.revision as number, assignmentRevision: row.assignment_revision as number, validated: this.evidence(podId, row.script_hash as string | null) !== null }))
    const latest = drafts[0] ? this.source(podId, { kind: 'draft', id: drafts[0].id }) : null
    const selected = selection ?? (latest && latest.hash !== pod.activeScript ? { kind: 'draft' as const, id: latest.id } : pod.activeScript ? { kind: 'version' as const, id: pod.activeScript } : drafts[0] ? { kind: 'draft' as const, id: drafts[0].id } : undefined)
    return { resourceEpoch: this.resources.epoch(podId), credentialAliases: this.resources.list(podId).filter(resource => resource.kind === 'credential' && resource.state === 'ready').map(resource => resource.configuration.alias as string).sort(), pod, versions, drafts, source: selected ? this.source(podId, selected) : null }
  }
}
