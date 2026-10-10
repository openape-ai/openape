import { ChatRegistry } from './chat-registry'
import { LegacyChatAdoption } from './adoption'
import { PodDescriptions } from './descriptions'
import { summarizeConversation } from './summarize'
import { MasterConversations } from './conversations'
import type { MasterCommand, MasterView } from '../../contracts/master'
import type { PodDatabase } from '../storage/database'
import type { AgentRuntime } from '../agent/executor'
import type { AgentGatewayServices } from '../agent/gateway'
import type { MasterControl } from './control'

/**
 * Retained conversation records and Pod descriptions. There is no in-app model turn:
 * every Pod mutation by an assistant enters through the MCP server and its owner session.
 */
export class MasterService {
  private readonly descriptions: PodDescriptions
  constructor(private readonly store: PodDatabase, runtime: AgentRuntime, private readonly control: MasterControl, private provider?: AgentGatewayServices['provider']) {
    this.descriptions = new PodDescriptions(store, (input, signal) => summarizeConversation(store, runtime, this.provider, input, signal))
    store.transaction(() => {
      store.db.prepare('UPDATE master_contexts SET state=\'interrupted\',error=\'Previous chat was interrupted.\' WHERE state=\'running\'').run()
      store.db.prepare('UPDATE master_messages SET state=\'interrupted\' WHERE state=\'streaming\'').run()
      store.db.prepare('UPDATE master_actions SET state=\'interrupted\',error=\'Action interrupted; inspect the current pod and draft before retrying\' WHERE state=\'running\'').run()
    })
  }

  setProvider(provider?: AgentGatewayServices['provider']): void {
    this.provider = provider
    if (provider) this.descriptions.start()
    else void this.descriptions.stop()
  }

  view(podId: string | null = '', creationId?: string, before?: number): MasterView {
    const conversations = new MasterConversations(this.store)
    const requested = creationId ? `creation:${creationId}` : podId ?? ''
    const scope = conversations.resolve(requested)
    const conversation = new ChatRegistry(this.store).ensure(scope)
    const podIds = conversation.context.pods.map(pod => pod.id)
    const boundPodId = conversation.originPodId && podIds.includes(conversation.originPodId) && !conversation.unavailablePodIds.includes(conversation.originPodId) ? conversation.originPodId : null
    const messages = conversations.messages(scope, before)
    const session = conversations.session(scope)
    return { conversation, activeConversationId: new ChatRegistry(this.store).view().activeConversationId, nextBefore: messages.length === 100 ? messages[0]!.sequence : null, adoption: boundPodId ? new LegacyChatAdoption(this.store).preview(boundPodId) : null, ...(requested.startsWith('creation:') ? { creationId: requested.slice(9), boundPodId } : {}), description: boundPodId ? this.descriptions.view(boundPodId) : null, initialRequest: boundPodId ? conversations.initial(boundPodId) : null, ...(boundPodId ? { scriptState: this.control.setup().scriptState(boundPodId) } : {}), connected: !!this.provider, state: session.state as MasterView['state'], error: session.error as string | null,
      messages,
      drafts: this.store.db.prepare('SELECT d.*,p.name FROM script_drafts d JOIN pods p ON p.id=d.pod_id WHERE d.pod_id IN (SELECT value FROM json_each(?)) ORDER BY d.rowid DESC LIMIT 20').all(JSON.stringify(podIds)).map(row => ({ validationError: this.store.db.prepare('SELECT error FROM master_actions WHERE json_extract(request,\'$.action\')=\'validate\' AND json_extract(request,\'$.draftId\')=? AND json_extract(request,\'$.draftRevision\')=? ORDER BY rowid DESC LIMIT 1').get(row.id, row.revision)?.error as string | null ?? null, id: row.id as string, podId: row.pod_id as string, name: row.name as string, revision: row.revision as number, code: row.code as string, capabilities: JSON.parse(row.capabilities as string) as string[], validation: row.validation as string | null, hash: row.script_hash as string | null })),
    }
  }

  async execute(command: MasterCommand): Promise<MasterView> {
    const registry = new ChatRegistry(this.store)
    const selected = command.conversationId ? command.type === 'list' ? registry.get(command.conversationId) : registry.assertRevision(command.conversationId, command.contextRevision!) : null
    if (selected && 'podId' in command && ['adopt', 'summarize'].includes(command.type) && !selected.context.pods.some(pod => pod.id === command.podId)) throw new Error('Setup action is outside the conversation context')
    if (command.type === 'adopt') { new LegacyChatAdoption(this.store).adopt(command.podId, command.hash); this.descriptions.request(command.podId); this.descriptions.start(); return this.view(selected?.scope ?? command.podId) }
    if (command.type === 'summarize') { this.descriptions.request(command.podId, true); this.descriptions.start(); return this.view(selected?.scope ?? command.podId) }
    return this.view(selected?.scope ?? command.podId ?? '', command.creationId, command.before)
  }

  async stop(): Promise<void> { await this.descriptions.stop() }
}
