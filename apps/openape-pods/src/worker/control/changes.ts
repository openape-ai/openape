import { PodVariables } from '../resources/variables'
import type { WorkflowCommand } from '../../contracts/workflows'
import { randomUUID } from 'node:crypto'
import type { ChangeSet } from '../../contracts/control-api'
import type { MasterAction } from '../../contracts/master'
import type { Conversation } from '../../contracts/chats'
import type { PodDatabase } from '../storage/database'
import { digest } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import { ChatRegistry } from '../master/chat-registry'

class TargetChangeError extends Error {
  constructor(readonly podId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Change could not be applied', { cause })
  }
}

export class ControlChanges {
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry) {}

  list(conversationId: string): ChangeSet[] {
    return this.store.db.prepare('SELECT body FROM control_changes WHERE conversation_id=? ORDER BY rowid DESC LIMIT 100').all(conversationId).map(row => this.withExecution(JSON.parse(row.body as string) as ChangeSet))
  }

  private withExecution(set: ChangeSet): ChangeSet {
    if (set.kind !== 'run') {
      for (const target of set.targets) {
        if (set.state === 'applied' && target.appliedBase) target.changedSinceApply = !this.store.db.prepare('SELECT 1 FROM pods WHERE id=?').get(target.podId) || digest(JSON.stringify(this.snapshot(target.podId))) !== target.appliedBase
      }
      return set
    }
    const receipt = this.store.db.prepare('SELECT * FROM control_runs WHERE id=?').get(set.id)
    if (!receipt) return set
    if (receipt.kind === 'workflow') {
      set.execution = this.store.db.prepare('SELECT pod_id,run_id,state,reason FROM workflow_nodes WHERE workflow_run_id=?').all(receipt.run_id).map(row => ({ podId: row.pod_id as string, runId: row.run_id as string | null, workflowId: set.workflow?.before.id, state: row.state as string, error: row.reason as string | null }))
    }
    else {
      const run = this.store.db.prepare('SELECT pod_id,state,error FROM runs WHERE id=?').get(receipt.run_id)
      set.execution = [{ podId: run?.pod_id as string ?? set.targets[0]!.podId, runId: receipt.run_id as string, state: run?.state as string ?? 'unavailable', error: run?.error as string | null ?? null }]
    }
    return set
  }

  private get(id: string): ChangeSet {
    const row = this.store.db.prepare('SELECT body FROM control_changes WHERE id=?').get(id)
    if (!row) throw new Error('Change set not found')
    return JSON.parse(row.body as string) as ChangeSet
  }

  private save(set: ChangeSet): void {
    this.store.db.prepare('INSERT INTO control_changes VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(set.id, set.conversationId, JSON.stringify(set))
  }

  private snapshot(podId: string) {
    return { pod: this.store.getPod(podId), epoch: this.resources.epoch(podId), variables: this.store.db.prepare('SELECT name,value,revision FROM pod_variables WHERE pod_id=? ORDER BY name').all(podId), schedule: this.store.db.prepare('SELECT revision,spec,enabled FROM schedules WHERE pod_id=?').get(podId) ?? null, organization: this.store.db.prepare('SELECT revision FROM pod_organization WHERE id=1').get(), groups: this.store.db.prepare('SELECT * FROM pod_groups ORDER BY rowid').all(), memberships: this.store.db.prepare('SELECT * FROM pod_memberships ORDER BY rowid').all() }
  }

  variables(context: Conversation, podId: string): Record<string, string> {
    const target = this.list(context.id).find(set => set.contextRevision === context.revision && set.state === 'pending' && set.kind === 'changes')?.targets.find(target => target.podId === podId)
    if (target && digest(JSON.stringify(this.snapshot(podId))) !== target.base) throw new Error('Pod configuration changed; inspect the current state and prepare this change again')
    return this.targetVariables(podId, target?.actions ?? [])
  }

  private targetVariables(podId: string, actions: MasterAction[]): Record<string, string> {
    const values = new PodVariables(this.store).values(podId)
    for (const action of actions) {
      if (action.action === 'setVariable') values[action.name] = action.value
    }
    return values
  }

  private draftHash(action: MasterAction): string | null {
    if (action.action !== 'activate') return null
    const row = this.store.db.prepare('SELECT * FROM script_drafts WHERE id=? AND pod_id=? AND revision=?').get(action.draftId, action.podId, action.draftRevision)
    if (!row) throw new Error('Draft changed or belongs to another pod')
    return digest(JSON.stringify(row))
  }

  prepare(context: Conversation, action: MasterAction): ChangeSet {
    if (!('podId' in action)) throw new Error('Change requires a selected Pod')
    const kind = action.action === 'run' ? 'run' : 'changes'
    const pending = this.list(context.id).find(set => set.contextRevision === context.revision && set.state === 'pending' && set.kind === kind && (kind !== 'run' || (!set.workflow && set.targets[0]?.podId === action.podId)))
    const set: ChangeSet = pending ?? { id: randomUUID(), conversationId: context.id, contextRevision: context.revision, revision: 0, kind, state: 'pending', targets: [], error: null, results: [] }
    let target = set.targets.find(target => target.podId === action.podId)
    if (!target) {
      const before = this.snapshot(action.podId)
      target = { podId: action.podId, name: before.pod.name, before, base: digest(JSON.stringify(before)), actions: [], review: [], draftHashes: {} }
      set.targets.push(target)
    }
    const key = (item: MasterAction) => `${item.action}:${item.action === 'setVariable' ? item.name : ''}`
    target.actions = target.actions.filter(item => key(item) !== key(action)); target.actions.push(action)
    target.draftHashes[key(action)] = this.draftHash(action)
    target.review = target.actions.map(item => this.review(item))
    set.revision++; set.error = null; this.save(set)
    return set
  }

  prepareWorkflow(context: Conversation, command: Extract<WorkflowCommand, { type: 'save' | 'start' }>): ChangeSet {
    if (!context.context.workflow || context.workflowChanged || command.id !== context.context.workflow.id || command.revision !== context.context.workflow.revision) throw new Error('Workflow changed; review its current members')
    if (command.type === 'save' && (command.enabled !== context.context.workflow.enabled || (command.enabled && JSON.stringify(command.schedule) !== JSON.stringify(context.context.workflow.schedule)))) throw new Error('Review schedule activation changes in Workflow settings')
    const ids = [...new Set([...context.context.workflow.nodes.map(node => node.podId), ...(command.type === 'save' ? command.nodes.map(node => node.podId) : [])])]
    if (ids.some(id => !context.context.pods.some(pod => pod.id === id))) throw new Error('Select all proposed workflow members before preparing changes')
    const kind = command.type === 'start' ? 'run' : 'changes'
    const set: ChangeSet = this.list(context.id).find(item => item.contextRevision === context.revision && item.kind === kind && item.state === 'pending' && (kind !== 'run' || item.workflow)) ?? { id: randomUUID(), conversationId: context.id, contextRevision: context.revision, revision: 0, kind, state: 'pending', targets: [], error: null, results: [] }
    for (const id of ids) {
      if (set.targets.some(target => target.podId === id)) continue
      const before = this.snapshot(id)
      set.targets.push({ podId: id, name: before.pod.name, before, base: digest(JSON.stringify(before)), actions: [], review: [], draftHashes: {} })
    }
    set.workflow = { before: context.context.workflow, command }; set.revision++; set.error = null; this.save(set)
    return set
  }

  private review(action: MasterAction) {
    if (!('podId' in action)) throw new Error('Change requires a selected Pod')
    const pod = this.store.getPod(action.podId)
    const currentCode = pod.activeScript ? this.store.readBlob(pod.activeScript).toString('utf8') : ''
    if (action.action === 'activate') {
      const draft = this.store.db.prepare('SELECT code,validation FROM script_drafts WHERE id=?').get(action.draftId)!
      return { action: action.action, before: currentCode, after: draft.code as string, evidence: draft.validation as string | null }
    }
    if (action.action === 'rollback') return { action: action.action, before: currentCode, after: this.store.db.prepare('SELECT 1 FROM scripts WHERE pod_id=? AND hash=?').get(pod.id, action.hash) ? this.store.readBlob(action.hash).toString('utf8') : action.hash, evidence: null }
    if (action.action === 'setVariable') return { action: `${action.action}: ${action.name}`, before: String(this.store.db.prepare('SELECT value FROM pod_variables WHERE pod_id=? AND name=?').get(pod.id, action.name)?.value ?? ''), after: action.value, evidence: null }
    if (action.action === 'revise') return { action: action.action, before: pod.name, after: action.name, evidence: null }
    if (action.action === 'pause') return { action: action.action, before: pod.lifecycle, after: 'paused', evidence: null }
    if (action.action === 'prepareSchedule') return { action: action.action, before: String(this.store.db.prepare('SELECT spec FROM schedules WHERE pod_id=?').get(pod.id)?.spec ?? ''), after: JSON.stringify(action.spec), evidence: 'The proposed schedule remains disabled.' }
    if (action.action === 'setGroup') return { action: action.action, before: String(this.store.db.prepare('SELECT name FROM pod_groups g JOIN pod_memberships m ON m.group_id=g.id WHERE m.pod_id=?').get(pod.id)?.name ?? ''), after: action.name ?? '', evidence: null }
    return { action: action.action, before: currentCode, after: currentCode, evidence: null }
  }

  private assertFree(podId: string): void {
    if (this.store.db.prepare('SELECT 1 FROM effect_ledger WHERE pod_id=? AND state!=\'completed\' LIMIT 1').get(podId)) throw new Error('An external effect has an unknown outcome; reconciliation evidence is required')
    if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=? UNION ALL SELECT 1 FROM program_leases WHERE pod_id=? UNION ALL SELECT 1 FROM workflow_reservations WHERE pod_id=? UNION ALL SELECT 1 FROM accepted_events WHERE pod_id=? AND state IN (\'pending\',\'blocked\',\'claimed\') LIMIT 1').get(podId, podId, podId, podId)) throw new Error('Pod has active or unresolved work; finish or recover it before applying changes')
  }

  private check(context: Conversation, set: ChangeSet): void {
    const current = new ChatRegistry(this.store).assertRevision(context.id, context.revision)
    if (set.workflow && (current.workflowChanged || current.context.workflow?.id !== set.workflow.before.id)) throw new Error('Workflow changed; review its current members')
    if (set.conversationId !== context.id || set.contextRevision !== context.revision) throw new Error('Change set belongs to an earlier conversation context; prepare it again')
    for (const target of set.targets) {
      try {
        if (!context.context.pods.some(pod => pod.id === target.podId) || context.unavailablePodIds.includes(target.podId)) throw new Error('Change target is unavailable or outside the conversation context')
        if (digest(JSON.stringify(this.snapshot(target.podId))) !== target.base) throw new Error('Pod configuration changed; inspect the current state and prepare this change again')
        this.assertFree(target.podId)
        for (const action of target.actions) {
          const key = `${action.action}:${action.action === 'setVariable' ? action.name : ''}`
          if (action.action === 'activate') {
            const evidence = this.store.db.prepare('SELECT validation FROM script_drafts WHERE id=?').get(action.draftId)?.validation
            const expected = digest(JSON.stringify(Object.entries(this.targetVariables(target.podId, target.actions)).sort()))
            if (!evidence || (JSON.parse(evidence as string) as { variablesHash?: string }).variablesHash !== expected) throw new Error('Validate the draft with the proposed variables before applying')
          }
          if (this.draftHash(action) !== target.draftHashes[key]) throw new Error('Draft changed; validate and review the current version')
        }
      }
      catch (error) { throw new TargetChangeError(target.podId, error) }
    }
  }

  retire(id: string, revision: number, podIds: string[]): ChangeSet {
    const set = this.get(id)
    if (set.revision !== revision || set.targets.some(target => !podIds.includes(target.podId)) || (set.workflow && set.workflow.before.nodes.some(node => !podIds.includes(node.podId)))) throw new Error('Select all targets and the current change revision before retiring it')
    if (set.state === 'discarded') return set
    if (set.state !== 'pending') throw new Error('Only pending legacy changes can be retired')
    set.state = 'discarded'; this.save(set); return set
  }

  execute(context: Conversation, id: string, revision: number, decision: 'applyChanges' | 'discardChanges', apply: (action: MasterAction) => unknown, run: (podId: string, operationId: string) => string, workflow?: (command: Extract<WorkflowCommand, { type: 'save' | 'start' }>, operationId: string) => unknown): ChangeSet {
    let set = this.get(id)
    if (set.conversationId !== context.id || set.contextRevision !== context.revision || set.revision !== revision) throw new Error('Change review changed; reload before deciding')
    if (set.state === 'applied' || set.state === 'discarded') {
      if ((set.state === 'applied') !== (decision === 'applyChanges')) throw new Error('Change decision conflicts with its completed receipt')
      return set
    }
    if (set.state !== 'pending') throw new Error('Run outcome requires inspection; automatic retry is disabled')
    if (decision === 'discardChanges') { set.state = 'discarded'; this.save(set); return set }
    if (this.store.db.prepare('SELECT 1 FROM master_session WHERE state=\'running\'').get()) throw new Error('Finish the active response before applying changes')
    try {
      this.store.transaction(() => {
        this.check(context, set)
        if (set.kind === 'run') { set.state = 'running'; this.save(set); return }
        const results: ChangeSet['results'] = []
        for (const target of set.targets) {
          try { for (const action of target.actions) results.push({ podId: target.podId, action: action.action, result: apply(action) }) }
          catch (error) { throw new TargetChangeError(target.podId, error) }
        }
        if (set.workflow) {
          if (!workflow) throw new Error('Workflow operation unavailable')
          const result = workflow(set.workflow.command, set.id)
          for (const target of set.targets) results.push({ podId: target.podId, action: 'workflow', result })
        }
        for (const target of set.targets) target.appliedBase = digest(JSON.stringify(this.snapshot(target.podId)))
        set.results = results; set.state = 'applied'; set.error = null; this.save(set)
      })
      if (set.kind === 'run') {
        const target = set.targets[0]!
        if (set.workflow) {
          if (!workflow) throw new Error('Workflow operation unavailable')
          const result = workflow(set.workflow.command, set.id)
          set.results = set.targets.map(target => ({ podId: target.podId, action: 'workflow', result }))
        }
        else {
          set.results = [{ podId: target.podId, action: 'run', result: { runId: run(target.podId, set.id) } }]
        }
        set.state = 'applied'; set.error = null; this.save(set)
      }
      return set
    }
    catch (error) {
      set = this.get(id)
      set.errorPodId = error instanceof TargetChangeError ? error.podId : undefined
      set.error = error instanceof Error ? error.message : 'Change could not be applied'
      if (set.state === 'running') set.state = 'failed'
      this.save(set); return set
    }
  }
}
