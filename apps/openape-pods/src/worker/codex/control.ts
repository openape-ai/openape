import { codexNetworkHelp } from '../../contracts/codex-networks'
import type { CodexNetworks } from './networks'
import { jevAvailability } from '../onboarding/store'
import { programHelp } from './program-help'
import { runtimeReference } from '../master/reference'
import { parseAdministration } from '../../contracts/codex-admin'
import type { AdministrationJournal, AdministrationReceipt } from '../../contracts/codex-admin'
import { digest } from '../storage/database'
import type { RunRecord } from '../../contracts/runs'
import type { Conversation } from '../../contracts/chats'
import { parseChatsCommand } from '../../contracts/chats'
import { boundedCodexResult, codexConversationId, desktopHelp, parseDesktopAction } from '../../contracts/codex'
import type { CodexRequest } from '../../contracts/codex'
import type { PodDatabase } from '../storage/database'
import { ChatRegistry } from '../master/chat-registry'
import type { MasterControl } from '../master/control'

export class CodexControl {
  constructor(private readonly store: PodDatabase, private readonly master: MasterControl, private readonly networks?: CodexNetworks) {}

  async execute(request: CodexRequest, signal: AbortSignal): Promise<unknown> {
    const { action } = request
    if (action.action === 'networks') {
      if (!this.networks) throw new Error('Network MCP is unavailable in this runtime')
      return this.networks.request(request)
    }
    let result: unknown
    switch (action.action) {
      case 'runtime': result = this.runtime(action); break
      case 'select': result = this.select(action); break
      default: result = withoutRunContent(await this.master.execute(`codex:${request.id}`, action, signal, this.conversation()))
    }
    return boundedCodexResult(result)
  }

  private runtime(action: Record<string, unknown>) {
    if (Object.keys(action).length !== 1) throw new Error('Invalid runtime fields')
    const { actions } = runtimeReference
    return {
      ...runtimeReference,
      jevConnection: jevAvailability(this.store),
      programHelp,
      networks: codexNetworkHelp,
      desktop: desktopHelp,
      workflow: [
        'Connected local Codex administers Pods directly. Codex governs any confirmation. Call list, then select with exact podIds. Reinspect current revisions after changes. Networks are the only way to connect Pods; see networks.',
        'Access: each MCP connection needs a session from the owner. While the owner is logged in with the apes CLI on this Mac (a human login of the registered owner), Pods opens it silently and renews it every hour; apes logout ends it. Otherwise the call fails with login_required and session {state:"pending",via:"browser",expiresAt}: Pods opened the owner\'s DDISA sign-in in the browser on this Mac; ask the owner to finish it and confirm it in the Pods app. Never wait for the owner inside one call: call {action:"session"} (always allowed) about every 5 seconds until state is signed_in, then retry the original call with the same requestId. On expired or denied tell the owner and retry the original call once for a new sign-in. A session acts as the owner and allows every action here for one hour, including network creation, activation and archive, member changes, recovery, owner routing and the grant decisions of the grants and sandbox actions. Pods records evidence sent through MCP with the prefix "Assistant request: " in receipts and traces.',
        'Save drafts and ordinary variables directly. Configure resources before validation. Import secrets by a private owner file path, never by their values. Do not copy owner login stores into Pods.',
        'Use scripts prepareDependencies when packages change. Validate the draft with current resources. Every assigned Pod secret is available to its scripts without declarations or approval. Then activate, resume and setSchedule with enabled=true as requested.',
        'run returns the actual runId. recovery list returns status and unresolved effect keys without run contents. Resolve uncertain delivery only with real external evidence; never guess that an effect failed.',
        'Synthetic validation does not prove live provider behavior or delivery.',
      ],
      actions: { ...actions, setSchedule: { ...actions.prepareSchedule, enabled: 'boolean; resume separately to allow scheduled execution' }, administration: 'resources/scripts/recovery/program/importSecret/requestSecret: see tool command schema. Include outer revision and command.podId. resources list returns epoch and safe assignment metadata. requestSecret {podId,alias,purpose,epoch} raises a request at OpenApe Secrets as the owner and returns {requestId,status,expiresAt}; the desktop collects the sealed value once and stores it under the alias.' },
      script: { ...runtimeReference.script, files: runtimeReference.script.files.replace('Only the owner can assign/change directory access in Permissions.', 'Connected Codex can assign directory access through resources.') },
    }
  }

  administration(command: AdministrationJournal): AdministrationReceipt {
    const { request } = command
    // Desktop commands are not Pod-scoped; they share only the receipt.
    const parsed = request.action.action === 'desktop' ? (parseDesktopAction(request.action), null) : parseAdministration(request.action)
    const action = parsed && parsed.kind !== 'grants' && parsed.kind !== 'sandbox' ? parsed : null
    const id = `codex-admin:${request.id}`
    const requestHash = digest(JSON.stringify(request.action))
    return this.store.transaction(() => {
      const prior = this.store.db.prepare('SELECT * FROM master_actions WHERE id=?').get(id)
      if (prior && prior.request_hash !== requestHash) throw new Error('Administration identity was reused with different arguments')
      if (command.type === 'begin') {
        if (prior?.state === 'completed') return { completed: true, result: JSON.parse(prior.result as string) }
        if (prior) throw new Error('Administration interrupted or already running; inspect state before a new request')
        if (action) {
          const podId = action.command.podId
          if (!this.conversation().context.pods.some(pod => pod.id === podId)) throw new Error('context_required: select this Pod before administration')
          const pod = this.store.getPod(podId)
          if (pod.revision !== action.revision || pod.lifecycle === 'archived') throw new Error('Pod changed or is archived; inspect its current revision')
        }
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
    if (!this.store.db.prepare('SELECT 1 FROM chat_conversations WHERE id=?').get(codexConversationId)) chats.execute({ type: 'create', id: codexConversationId, title: 'Codex', podIds: [] })
    return chats.get(codexConversationId)
  }

  private select(action: Record<string, unknown>) {
    if (Object.keys(action).some(key => !['action', 'podIds'].includes(key))) throw new Error('Invalid select fields')
    const current = this.conversation()
    const command = parseChatsCommand({ type: 'context', id: codexConversationId, revision: current.revision, podIds: action.podIds })
    if (command.type !== 'context') throw new Error('Invalid select')
    const unchanged = JSON.stringify([...command.podIds].sort()) === JSON.stringify([...current.context.podIds].sort())
    if (!unchanged) new ChatRegistry(this.store).execute(command)
    const next = this.conversation()
    return { contextRevision: next.revision, pods: next.context.pods }
  }
}

// Run summaries, run errors and checkpoints are written by scripts during runs
// and can carry mail or web content; Codex sees run state only.
function withoutRunContent(result: unknown): unknown {
  if (!result || typeof result !== 'object' || !('runs' in result) || !('checkpoint' in result)) return result
  const { runs, checkpoint, ...rest } = result as { runs: RunRecord[], checkpoint: { revision: number } }
  return { ...rest, runs: runs.map(({ id, state, scriptHash, startedAt, finishedAt, recovery }) => ({ id, state, scriptHash, startedAt, finishedAt, recovery: recovery?.state ?? null })), checkpoint: { revision: checkpoint.revision } }
}
