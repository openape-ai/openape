import type { ChangeSet } from '../../contracts/control-api'
import type { RunRecord } from '../../contracts/runs'
import type { Conversation } from '../../contracts/chats'
import { parseChatsCommand } from '../../contracts/chats'
import { codexConversationId } from '../../contracts/codex'
import type { CodexRequest } from '../../contracts/codex'
import type { PodDatabase } from '../storage/database'
import { ChatRegistry } from '../master/chat-registry'
import type { MasterControl } from '../master/control'

// Settings changes that cannot alter what a Pod does with its existing access;
// Codex applies them directly (owner decision, issue 1375). Activation, rollback,
// variables, runs and permissions stay reviews the owner applies in the app.
const direct = ['revise', 'setGroup', 'pause', 'prepareSchedule']

// Entry point for the owner's Codex. Every action runs through the same
// MasterControl executor as the in-app chat, scoped to one hidden conversation.
export class CodexControl {
  constructor(private readonly store: PodDatabase, private readonly master: MasterControl) {}

  async execute(request: CodexRequest, signal: AbortSignal): Promise<unknown> {
    const { action } = request
    const result = action.action === 'select'
      ? this.select(action)
      : action.action === 'changes'
        ? this.changes(action)
        : direct.includes(String(action.action))
          ? await this.direct(request, signal)
          : withoutRunContent(await this.master.execute(`codex:${request.id}`, action, signal, null, null, this.conversation()))
    if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new Error('Action completed but its result is too large; inspect a smaller portion')
    return result
  }

  private async direct(request: CodexRequest, signal: AbortSignal): Promise<unknown> {
    const { podId, action } = request.action
    if (typeof podId !== 'string' || !this.conversation().context.pods.some(pod => pod.id === podId)) throw new Error('context_required: select this Pod before changing it')
    if (action === 'prepareSchedule' && this.store.db.prepare('SELECT enabled FROM schedules WHERE pod_id=?').get(podId)?.enabled === 1) throw new Error('Review an enabled schedule in Pod settings before replacing it')
    return this.master.execute(`codex:${request.id}`, request.action, signal)
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
    return { changes: this.master.changes().list(codexConversationId).slice(0, 20).map(receipt), approval: 'The owner applies changes and starts runs in OpenApe Pods under Prepared by Codex.' }
  }
}

function receipt(set: ChangeSet) {
  return { id: set.id, kind: set.kind, state: set.state, error: set.error, targets: set.targets.map(target => ({ podId: target.podId, name: target.name, actions: target.actions.map(action => action.action), changedSinceApply: target.changedSinceApply ?? false })), execution: set.execution?.map(({ podId, runId, state }) => ({ podId, runId, state })) ?? null }
}

// Run summaries, run errors and checkpoints are written by scripts during runs
// and can carry mail or web content; Codex sees run state only.
function withoutRunContent(result: unknown): unknown {
  if (!result || typeof result !== 'object' || !('runs' in result) || !('checkpoint' in result)) return result
  const { runs, checkpoint, ...rest } = result as { runs: RunRecord[], checkpoint: { revision: number } }
  return { ...rest, runs: runs.map(({ id, state, scriptHash, startedAt, finishedAt, recovery }) => ({ id, state, scriptHash, startedAt, finishedAt, recovery: recovery?.state ?? null })), checkpoint: { revision: checkpoint.revision } }
}
