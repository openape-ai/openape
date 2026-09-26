import { jevAvailability } from '../onboarding/store'
import { programHelp } from './program-help'
import { runtimeReference } from '../master/reference'
import { parseAdministration } from '../../contracts/codex-admin'
import type { AdministrationJournal, AdministrationReceipt } from '../../contracts/codex-admin'
import { digest } from '../storage/database'
import type { ChangeSet } from '../../contracts/control-api'
import type { RunRecord } from '../../contracts/runs'
import type { Conversation } from '../../contracts/chats'
import { parseChatsCommand } from '../../contracts/chats'
import { codexConversationId } from '../../contracts/codex'
import type { CodexRequest } from '../../contracts/codex'
import type { PodDatabase } from '../storage/database'
import { ChatRegistry } from '../master/chat-registry'
import type { MasterControl } from '../master/control'

export class CodexControl {
  constructor(private readonly store: PodDatabase, private readonly master: MasterControl) {}

  async execute(request: CodexRequest, signal: AbortSignal): Promise<unknown> {
    const { action } = request
    if (action.action === 'requestAccess') throw new Error('Use resources, program or importSecret to configure access directly')
    let result: unknown
    switch (action.action) {
      case 'runtime': result = this.runtime(action); break
      case 'retireChange': result = this.retire(action); break
      case 'select': result = this.select(action); break
      case 'changes': result = this.changes(action); break
      default: result = withoutRunContent(await this.master.execute(`codex:${request.id}`, action, signal, null, null, this.conversation(), 'owner'))
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new Error('Action completed but its result is too large; inspect a smaller portion')
    return result
  }

  private retire(action: Record<string, unknown>) {
    if (Object.keys(action).some(key => !['action', 'id', 'revision'].includes(key)) || typeof action.id !== 'string' || !Number.isSafeInteger(action.revision)) throw new Error('Invalid legacy change identity')
    return receipt(this.master.changes().retire(action.id, Number(action.revision), this.conversation().context.podIds))
  }

  private runtime(action: Record<string, unknown>) {
    if (Object.keys(action).length !== 1) throw new Error('Invalid runtime fields')
    const { requestAccess: _proposal, ...actions } = runtimeReference.actions
    return {
      ...runtimeReference,
      jevConnection: jevAvailability(this.store),
      programHelp,
      workflow: [
        'Connected local Codex administers Pods directly. Codex governs any confirmation. Call list, then select with exact podIds and optionally workflowId/workflowRevision. Reinspect current revisions after changes.',
        'Save drafts and ordinary variables directly. Configure resources before validation. Import secrets by a private owner file path, never by their values. Do not copy owner login stores into Pods.',
        'Use scripts prepareDependencies when packages change. Validate the draft with current resources. Every assigned Pod secret is available to its scripts without declarations or approval. Then activate, resume and setSchedule with enabled=true as requested.',
        'run returns the actual runId. recovery list returns status and unresolved effect keys without run contents. Resolve uncertain delivery only with real external evidence; never guess that an effect failed.',
        'Old pending changes are history and never automatically execute. Synthetic validation does not prove live provider behavior or delivery.',
      ],
      actions: { ...actions, saveWorkflow: { definition: 'Save a workflow with explicitly selected members. To create: select member podIds without a workflow, then send type:save, a new UUID id, revision:0, name, nodes, schedule and enabled. To update: select the existing workflow and its current revision first.' }, setSchedule: { ...actions.prepareSchedule, enabled: 'boolean; resume separately to allow scheduled execution' }, administration: 'resources/scripts/recovery/program/importSecret: see tool command schema. Include outer revision and command.podId. resources list returns epoch and safe assignment metadata.' },
      script: { ...runtimeReference.script, files: runtimeReference.script.files.replace('Only the owner can assign/change directory access in Permissions.', 'Connected Codex can assign directory access through resources.') },
    }
  }

  administration(command: AdministrationJournal): AdministrationReceipt {
    const { request } = command
    const action = parseAdministration(request.action)
    const id = `codex-admin:${request.id}`
    const requestHash = digest(JSON.stringify(request.action))
    return this.store.transaction(() => {
      const prior = this.store.db.prepare('SELECT * FROM master_actions WHERE id=?').get(id)
      if (prior && prior.request_hash !== requestHash) throw new Error('Administration identity was reused with different arguments')
      if (command.type === 'begin') {
        if (prior?.state === 'completed') return { completed: true, result: JSON.parse(prior.result as string) }
        if (prior) throw new Error('Administration interrupted or already running; inspect state before a new request')
        const podId = action.command.podId
        if (!this.conversation().context.pods.some(pod => pod.id === podId)) throw new Error('context_required: select this Pod before administration')
        const pod = this.store.getPod(podId)
        if (pod.revision !== action.revision || pod.lifecycle === 'archived') throw new Error('Pod changed or is archived; inspect its current revision')
        this.store.db.prepare('INSERT INTO master_actions VALUES(?,?,?,\'running\',NULL,NULL)').run(id, requestHash, JSON.stringify(request.action))
        return { completed: false }
      }
      if (!prior || prior.state !== 'running') throw new Error('Administration receipt is not pending')
      if (command.type === 'complete') {
        this.store.db.prepare('UPDATE master_actions SET state=\'completed\',result=? WHERE id=?').run(JSON.stringify(command.result), id)
        return { completed: true, result: command.result }
      }
      this.store.db.prepare('UPDATE master_actions SET state=\'failed\',error=\'Administration failed; inspect before retrying\' WHERE id=?').run(id)
      return { completed: false }
    })
  }

  private conversation(): Conversation {
    const chats = new ChatRegistry(this.store)
    if (!this.store.db.prepare('SELECT 1 FROM chat_conversations WHERE id=?').get(codexConversationId)) chats.execute({ type: 'create', id: codexConversationId, title: 'Codex', podIds: [], workflowId: null, workflowRevision: null })
    return chats.get(codexConversationId)
  }

  private select(action: Record<string, unknown>) {
    if (Object.keys(action).some(key => !['action', 'podIds', 'workflowId', 'workflowRevision'].includes(key))) throw new Error('Invalid select fields')
    const current = this.conversation()
    const command = parseChatsCommand({ type: 'context', id: codexConversationId, revision: current.revision, podIds: action.podIds, workflowId: action.workflowId ?? null, workflowRevision: action.workflowRevision ?? null })
    if (command.type !== 'context') throw new Error('Invalid select')
    const unchanged = JSON.stringify([...command.podIds].sort()) === JSON.stringify([...current.context.podIds].sort()) && command.workflowId === (current.context.workflow?.id ?? null) && (!command.workflowId || command.workflowRevision === current.context.workflow?.revision)
    if (!unchanged) new ChatRegistry(this.store).execute(command)
    const next = this.conversation()
    return { contextRevision: next.revision, pods: next.context.pods, workflow: next.context.workflow && { id: next.context.workflow.id, name: next.context.workflow.name, revision: next.context.workflow.revision } }
  }

  private changes(action: Record<string, unknown>) {
    if (Object.keys(action).length !== 1) throw new Error('Invalid changes fields')
    return { changes: this.master.changes().list(codexConversationId).slice(0, 20).map(receipt), approval: 'Legacy proposals are not applied automatically. New Codex actions apply directly.' }
  }
}

function receipt(set: ChangeSet) {
  return { id: set.id, revision: set.revision, kind: set.kind, state: set.state, error: set.error, targets: set.targets.map(target => ({ podId: target.podId, name: target.name, actions: target.actions.map(action => action.action), changedSinceApply: target.changedSinceApply ?? false })), execution: set.execution?.map(({ podId, runId, state }) => ({ podId, runId, state })) ?? null }
}

// Run summaries, run errors and checkpoints are written by scripts during runs
// and can carry mail or web content; Codex sees run state only.
function withoutRunContent(result: unknown): unknown {
  if (!result || typeof result !== 'object' || !('runs' in result) || !('checkpoint' in result)) return result
  const { runs, checkpoint, ...rest } = result as { runs: RunRecord[], checkpoint: { revision: number } }
  return { ...rest, runs: runs.map(({ id, state, scriptHash, startedAt, finishedAt, recovery }) => ({ id, state, scriptHash, startedAt, finishedAt, recovery: recovery?.state ?? null })), checkpoint: { revision: checkpoint.revision } }
}
