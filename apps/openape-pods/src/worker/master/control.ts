import { jevAvailability } from '../onboarding/store'
import type { WorkflowEngine } from '../workflows/engine'
import type { Conversation } from '../../contracts/chats'
import { ChatRegistry } from './chat-registry'
import { MasterSetup } from './setup'
import { DependencyStore } from '../dependencies/store'
import { emptyPackages } from '../../contracts/dependencies'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parseMasterAction } from '../../contracts/master'
import type { MasterAction } from '../../contracts/master'
import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import type { RunDispatcher } from '../runs/dispatcher'
import type { Scheduler } from '../scheduling/scheduler'
import type { AgentRuntime } from '../agent/executor'
import { ScriptWorkspace } from '../workspace/scripts'
import { WorkspaceDetails } from '../workspace/details'
import { assignedMail } from '../../main/mail/assigned'
import { installMailRecipe } from '../mail/install'
import { validateDraft } from './validation'
import { runtimeReference } from './reference'
import { PodVariables } from '../resources/variables'
import { PodGroups } from '../workspace/groups'
import { modelResources } from './resources'
import { inspectGraph } from '../workflows/items'
import type { WorkflowDefinition } from '../../contracts/workflows'

export class MasterControl {
  setup(): MasterSetup { return new MasterSetup(this.store, this.resources) }
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, private readonly dispatcher: RunDispatcher, private readonly scheduler: Scheduler, private readonly runtime: AgentRuntime, private readonly workflows?: WorkflowEngine, private readonly startRun: (podId: string, operationId: string) => string = (podId, operationId) => dispatcher.start(podId, { reason: 'manual', eventIds: [], operationId })) {}
  async execute(key: string, value: unknown, signal: AbortSignal, context?: Conversation): Promise<unknown> {
    if (!key || key.length > 300) throw new Error('Invalid master operation identity')
    const requested = parseMasterAction(value)
    if (context) context = new ChatRegistry(this.store).assertRevision(context.id, context.revision)
    const action = requested.action === 'setGraphValue' ? this.graphValue(requested, context) : requested
    if (context) {
      if ('podId' in action && !context.context.pods.some(pod => pod.id === action.podId)) throw new Error('context_required: select this Pod with + before inspecting or changing it')
    }
    const request = JSON.stringify(action); const hash = digest(JSON.stringify({ action, ...(context ? { conversationId: context.id, contextRevision: context.revision } : {}) }))
    const prior = this.store.db.prepare('SELECT * FROM master_actions WHERE id=?').get(key)
    if (prior) {
      if (prior.request_hash !== hash) throw new Error('Master operation identity was reused with different arguments')
      if (prior.state === 'completed') return JSON.parse(prior.result as string) as unknown
      throw new Error(prior.error as string || 'Master action is already running or interrupted; inspect before retrying')
    }
    signal.throwIfAborted()
    if ('podId' in action) this.assertPod(action.podId, action.revision, action.action === 'inspect')
    if (action.action === 'saveWorkflow' && action.definition.revision === 0) {
      if (!this.workflows || !context || context.context.workflow) throw new Error('Select only the member Pods before creating a workflow')
      if (action.definition.nodes.some(node => !context.context.pods.some(pod => pod.id === node.podId))) throw new Error('Select every workflow Pod before saving')
      return this.store.transaction(() => {
        this.workflows!.save(action.definition)
        const result = { workflowId: action.definition.id, revision: 1 }
        this.store.db.prepare('INSERT INTO master_actions VALUES(?,?,?,\'completed\',?,NULL)').run(key, hash, request, JSON.stringify(result))
        return result
      })
    }
    if (action.action === 'inspectWorkflow' || action.action === 'runWorkflow' || action.action === 'saveWorkflow') {
      if (!context?.context.workflow) throw new Error('Select a workflow before using this action')
      const workflow = context.context.workflow
      return this.store.transaction(() => {
        const result = action.action === 'inspectWorkflow' ? this.inspectWorkflow(workflow, context.workflowChanged) : this.executeWorkflow(action, context, key)
        this.store.db.prepare('INSERT INTO master_actions VALUES(?,?,?,\'completed\',?,NULL)').run(key, hash, request, JSON.stringify(result)); return result
      })
    }
    if (action.action === 'validate') {
      this.store.db.prepare('INSERT INTO master_actions VALUES(?,?,?,\'running\',NULL,NULL)').run(key, hash, request)
      try {
        this.assertDraft(action.podId, action.draftId, action.draftRevision)
        const result = await validateDraft(this.store, this.resources, this.runtime, action.draftId, action.draftRevision, signal)
        this.store.db.prepare('UPDATE master_actions SET state=\'completed\',result=? WHERE id=?').run(JSON.stringify(result), key)
        return result
      }
      catch (error) { this.store.db.prepare('UPDATE master_actions SET state=\'failed\',error=? WHERE id=?').run(error instanceof Error ? error.message : 'Validation failed', key); throw error }
    }
    if (action.action === 'run') {
      this.store.transaction(() => {
        this.assertPod(action.podId, action.revision, false)
        this.store.db.prepare('INSERT INTO master_actions VALUES(?,?,?,\'running\',NULL,NULL)').run(key, hash, request)
      })
      let startedRunId: string | null = null
      try {
        startedRunId = this.startRun(action.podId, key)
        const result = { runId: startedRunId }
        this.store.db.prepare('UPDATE master_actions SET state=\'completed\',result=? WHERE id=?').run(JSON.stringify(result), key)
        return result
      }
      catch (failure) {
        const accepted = this.store.db.prepare('SELECT run_id FROM control_runs WHERE id=? AND kind=\'pod\'').get(key)
        startedRunId = startedRunId ?? (accepted?.run_id as string | undefined) ?? null
        this.store.db.prepare('UPDATE master_actions SET state=?,result=?,error=? WHERE id=?').run(startedRunId ? 'running' : 'failed', startedRunId ? JSON.stringify({ runId: startedRunId }) : null, failure instanceof Error ? failure.message : 'Reviewed run could not start', key)
        throw failure
      }
    }
    let dependencyLockHash = ''
    if (action.action === 'installMailRecipe') dependencyLockHash = (JSON.parse(await readFile(this.runtime.manifest, 'utf8')) as { dependencyLockHash: string }).dependencyLockHash
    signal.throwIfAborted()
    return this.store.transaction(() => {
      if ('podId' in action) this.assertPod(action.podId, action.revision, action.action === 'inspect')
      const result = this.apply(action, dependencyLockHash, context)
      this.store.db.prepare('INSERT INTO master_actions VALUES(?,?,?,\'completed\',?,NULL)').run(key, hash, request, JSON.stringify(result))
      return result
    })
  }

  /** A graph value is one field of the definition, so setting it is a save of the selected graph. */
  private graphValue(action: Extract<MasterAction, { action: 'setGraphValue' }>, context?: Conversation | null): Extract<MasterAction, { action: 'saveWorkflow' }> {
    const selected = context?.context.workflow
    if (!selected) throw new Error('Select a workflow before using this action')
    if (selected.mode !== 'channels') throw new Error('Channels, gates and graph values need channel mode')
    if ((selected.values.find(value => value.name === action.name)?.revision ?? 0) !== action.valueRevision) throw new Error('Graph value changed; inspect the workflow again')
    const { paused: _paused, nextAt: _nextAt, ...saved } = selected
    return { action: 'saveWorkflow', definition: { ...saved, type: 'save', values: [...selected.values.filter(value => value.name !== action.name), { name: action.name, value: action.value, revision: action.valueRevision }] } }
  }

  /** The contract and rights of the member Pods are read now, so the diagnostics describe the graph as it would run. */
  private inspectWorkflow(definition: WorkflowDefinition, changed: boolean) {
    if (definition.mode !== 'channels') return { definition, changed }
    const { contracts, edges, nodeKinds, diagnostics } = inspectGraph(this.store, definition)
    return { definition, changed, contracts, edges, nodeKinds, diagnostics }
  }

  private executeWorkflow(action: Extract<MasterAction, { action: 'saveWorkflow' | 'runWorkflow' | 'inspectWorkflow' }>, context: Conversation, key: string) {
    const selected = context.context.workflow
    if (!this.workflows || !selected || context.workflowChanged) throw new Error('Select the current workflow revision before changing it')
    if (selected.nodes.some(node => !context.context.pods.some(pod => pod.id === node.podId))) throw new Error('Select every workflow Pod before saving')
    if (action.action === 'runWorkflow') return { workflowRunId: this.workflows.start(selected.id, selected.revision, 'manual', key) }
    if (action.action !== 'saveWorkflow') throw new Error('Unsupported workflow operation')
    if (action.definition.id !== selected.id || action.definition.revision !== selected.revision) throw new Error('Workflow changed; select its current revision')
    if (action.definition.nodes.some(node => !context.context.pods.some(pod => pod.id === node.podId))) throw new Error('Select every workflow Pod before saving')
    this.workflows.save(action.definition)
    return { workflowId: selected.id, revision: selected.revision + 1 }
  }

  private organization(podId: string) {
    const state = new PodGroups(this.store).view()
    return { revision: state.revision, groups: state.groups.map(({ id, name, podIds }) => ({ id, name, selected: podIds.includes(podId) })) }
  }

  private assertPod(id: string, revision: number, inspect = false): void {
    const pod = this.store.getPod(id)
    if (pod.revision !== revision) throw new Error('Pod settings changed; reload its current revision')
    if (pod.lifecycle === 'archived' && !inspect) throw new Error('Archived pods are inspectable in the workspace but cannot be changed by the master')
  }

  private assertDraft(podId: string, id: string, revision: number) {
    const draft = this.store.db.prepare('SELECT * FROM script_drafts WHERE id=? AND pod_id=? AND revision=?').get(id, podId, revision)
    if (!draft) throw new Error('Draft changed or belongs to another pod')
    return draft
  }

  private apply(action: MasterAction, lock: string, context?: Conversation): unknown {
    if (action.action === 'runtime') return { ...runtimeReference, jevConnection: jevAvailability(this.store) }
    if (action.action === 'list') return { jev: jevAvailability(this.store), pods: this.store.listPods().map(pod => context ? { id: pod.id, name: pod.name, revision: pod.revision, lifecycle: pod.lifecycle, selected: context.context.pods.some(item => item.id === pod.id) } : pod), ...(context ? { workflows: this.store.db.prepare('SELECT id,name,revision,nodes FROM workflows WHERE archived=0').all().map(row => ({ id: row.id, name: row.name, revision: row.revision, podIds: (JSON.parse(row.nodes as string) as { podId: string }[]).map(node => node.podId) })) } : {}) }
    if (action.action === 'create') {
      if (this.store.listPods().length >= 100) throw new Error('Local pod limit reached')
      return this.store.createPod({ name: action.name })
    }
    if (!('podId' in action)) throw new Error('Change requires a selected Pod')
    const pod = this.store.getPod(action.podId)
    if (action.action === 'inspect') {
      const scripts = new ScriptWorkspace(this.store, this.resources, this).view(pod.id)
      return { jev: jevAvailability(this.store), pod, script: scripts.source, resources: modelResources(this.resources.list(pod.id), true), variables: new PodVariables(this.store).list(pod.id), schedule: this.scheduler.view(pod.id), organization: this.organization(pod.id), versions: scripts.versions, runs: this.dispatcher.view(pod.id).runs, checkpoint: this.store.checkpoint(pod.id), setup: this.setup().proposals(pod.id) }
    }
    if (action.action === 'setVariable') {
      new PodVariables(this.store).save(pod.id, action.name, action.value, action.variableRevision)
      return { variables: new PodVariables(this.store).list(pod.id) }
    }
    if (action.action === 'setSchedule') {
      this.scheduler.save(pod.id, action.scheduleRevision, action.spec, action.enabled)
      return { schedule: this.scheduler.view(pod.id) }
    }
    if (action.action === 'prepareSchedule') {
      this.scheduler.save(pod.id, action.scheduleRevision, action.spec, false)
      this.scheduler.lifecycle(pod.id, pod.revision, 'paused')
      return { schedule: this.scheduler.view(pod.id), lifecycle: 'paused', activation: 'owner-only-in-settings' }
    }
    if (action.action === 'setGroup') {
      const groups = new PodGroups(this.store); let state = groups.view()
      if (state.revision !== action.organizationRevision) throw new Error('Groups changed. Refresh and try again.')
      let group = state.groups.find(item => item.name.toLowerCase() === action.name?.toLowerCase())
      if (action.name && !group) {
        groups.execute({ type: 'organize', action: 'create', name: action.name, revision: state.revision })
        state = groups.view(); group = state.groups.find(item => item.name === action.name)
      }
      groups.execute({ type: 'organize', action: 'move', podId: pod.id, groupId: group?.id ?? null, revision: state.revision })
      return this.organization(pod.id)
    }
    if (action.action === 'revise') { this.store.updatePod(pod.id, action.revision, { name: action.name, lifecycle: pod.lifecycle }); return this.store.getPod(pod.id) }
    if (action.action === 'resume') {
      if (!pod.activeScript || !this.store.db.prepare('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(pod.id, pod.activeScript, pod.bindingRevision, this.resources.epoch(pod.id))) throw new Error('Validate and activate a script for the current script and permissions before resuming')
      const version = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(pod.id, pod.activeScript)
      if (version && (JSON.parse(version.manifest as string) as { capabilities: string[] }).capabilities.includes('mail.read')) assignedMail(this.resources.list(pod.id))
    }
    if (action.action === 'pause' || action.action === 'resume') { this.scheduler.lifecycle(pod.id, action.revision, action.action === 'pause' ? 'paused' : 'active'); return this.store.getPod(pod.id) }
    if (action.action === 'installMailRecipe') return { hash: installMailRecipe(this.store, this.resources, pod.id, lock) }
    if (action.action === 'draft') {
      if (action.draftId) this.assertDraft(pod.id, action.draftId, action.draftRevision)
      else if (action.draftRevision !== 0) throw new Error('A new draft starts at revision zero')
      const id = action.draftId ?? randomUUID(); const revision = action.draftRevision + 1
      this.store.db.prepare('INSERT INTO script_drafts VALUES(?,?,?,?,?,?,NULL,NULL) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,assignment_revision=excluded.assignment_revision,code=excluded.code,capabilities=excluded.capabilities,validation=NULL,script_hash=NULL').run(id, pod.id, revision, pod.bindingRevision, action.code, JSON.stringify(action.capabilities))
      this.store.db.prepare('DELETE FROM definition_update_drafts WHERE draft_id=?').run(id)
      const previous = this.store.db.prepare('SELECT manifest FROM draft_packages WHERE draft_id=?').get(id)
      const packages = action.packages ?? (previous ? JSON.parse(previous.manifest as string) : pod.activeScript ? new DependencyStore(this.store).scriptManifest(pod.id, pod.activeScript) : emptyPackages())
      this.store.db.prepare('INSERT INTO draft_packages VALUES(?,?) ON CONFLICT(draft_id) DO UPDATE SET manifest=excluded.manifest').run(id, JSON.stringify(packages))
      return { draftId: id, draftRevision: revision, status: 'draft', capabilities: action.capabilities, packages }
    }
    if (action.action === 'activate' || action.action === 'rollback') {
      const draft = action.action === 'activate' ? this.assertDraft(pod.id, action.draftId, action.draftRevision) : null
      if (draft && (!draft.script_hash || !draft.validation || draft.assignment_revision !== pod.bindingRevision)) throw new Error('Validate this draft for the current permissions first')
      const hash = action.action === 'rollback' ? action.hash : draft?.script_hash as string
      new WorkspaceDetails(this.store, this.resources).execute({ type: 'activate', podId: pod.id, hash, expectedActive: action.action === 'rollback' ? action.expectedActive : pod.activeScript, assignmentRevision: pod.bindingRevision })
      return { activeScript: hash, previousScript: pod.activeScript }
    }
    if (action.action === 'requestAccess') {
      const existing = this.store.db.prepare('SELECT id FROM access_proposals WHERE pod_id=? AND body=? AND state=\'pending\'').get(pod.id, JSON.stringify(action.request))
      if (existing) return { id: existing.id, status: 'pending-owner-review', request: action.request }
      const id = randomUUID()
      this.store.db.prepare('INSERT INTO access_proposals VALUES(?,?,?,\'pending\')').run(id, pod.id, JSON.stringify(action.request))
      return { id, status: 'pending-owner-review', request: action.request }
    }
    throw new Error('Master action has no implementation')
  }
}
