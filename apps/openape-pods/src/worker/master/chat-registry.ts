import { randomUUID } from 'node:crypto'
import type { ChatsCommand, ChatsView, Conversation, ChatContext } from '../../contracts/chats'
import { parseChatsCommand } from '../../contracts/chats'
import { codexConversationId } from '../../contracts/codex'
import type { WorkflowDefinition } from '../../contracts/workflows'
import type { PodDatabase } from '../storage/database'

export class ChatRegistry {
  constructor(private readonly store: PodDatabase) {}

  private snapshot(podIds: string[], workflowId: string | null, revision: number | null): ChatContext {
    let workflow: WorkflowDefinition | null = null
    if (workflowId) {
      const row = this.store.db.prepare('SELECT * FROM workflows WHERE id=? AND archived=0').get(workflowId)
      if (!row || row.revision !== revision) throw new Error('Workflow changed; review its current members')
      workflow = { id: workflowId, revision: row.revision as number, name: row.name as string, nodes: JSON.parse(row.nodes as string), schedule: row.schedule ? JSON.parse(row.schedule as string) : null, enabled: row.enabled === 1, paused: row.paused === 1, nextAt: row.next_at as number | null, ...(row.mail ? { mail: JSON.parse(row.mail as string) } : {}) }
    }
    const ids = [...new Set([...podIds, ...workflow?.nodes.map(node => node.podId) ?? []])]
    if (ids.length > 32) throw new Error('Select at most 32 Pods including workflow members')
    const pods = ids.map(id => this.store.getPod(id))
    if (pods.some(pod => pod.lifecycle === 'archived')) throw new Error('Archived Pods cannot be added to a chat')
    return { podIds, pods: pods.map(({ id, name }) => ({ id, name })), workflow }
  }

  ensure(scope: string): Conversation {
    const existing = this.store.db.prepare('SELECT id FROM chat_conversations WHERE scope=?').get(scope)
    if (existing) return this.get(existing.id as string)
    if (scope.startsWith('chat:')) throw new Error('Conversation not found')
    const pod = scope && !scope.startsWith('creation:') ? this.store.getPod(scope) : null
    const id = randomUUID(); const now = Date.now()
    const context: ChatContext = { podIds: pod ? [pod.id] : [], pods: pod ? [{ id: pod.id, name: pod.name }] : [], workflow: null }
    this.store.transaction(() => {
      this.store.db.prepare('INSERT INTO chat_conversations VALUES(?,?,?,?,1,?,?)').run(id, scope, pod ? `${pod.name} conversation` : scope ? 'New Pod' : 'Workspace chat', pod?.id ?? null, now, now)
      this.saveContext(id, 1, context)
      this.store.db.prepare('INSERT OR IGNORE INTO chat_message_context SELECT message_id,?,1 FROM master_message_scopes WHERE scope=?').run(id, scope)
    })
    return this.get(id)
  }

  get(id: string): Conversation {
    const row = this.store.db.prepare('SELECT c.*,x.body FROM chat_conversations c JOIN chat_contexts x ON x.conversation_id=c.id AND x.revision=c.revision WHERE c.id=?').get(id)
    if (!row) throw new Error('Conversation not found')
    const context = JSON.parse(row.body as string) as ChatContext
    const currentWorkflow = context.workflow ? this.store.db.prepare('SELECT revision,archived FROM workflows WHERE id=?').get(context.workflow.id) : null
    const available = this.store.listPods().filter(pod => pod.lifecycle !== 'archived').map(pod => pod.id)
    return { relatedWorkflowIds: this.store.db.prepare('SELECT DISTINCT json_extract(body,\'$.workflow.id\') AS id FROM chat_contexts WHERE conversation_id=? AND json_extract(body,\'$.workflow.id\') IS NOT NULL').all(id).map(row => row.id as string), id, scope: row.scope as string, title: row.title as string, revision: row.revision as number, originPodId: row.origin_pod as string | null, updatedAt: row.updated_at as number, context, workflowChanged: !!context.workflow && (!currentWorkflow || currentWorkflow.archived === 1 || currentWorkflow.revision !== context.workflow.revision), unavailablePodIds: context.pods.filter(pod => !available.includes(pod.id)).map(pod => pod.id), relatedPodIds: this.store.db.prepare('SELECT pod_id FROM chat_members WHERE conversation_id=?').all(id).map(item => item.pod_id as string) }
  }

  assertRevision(id: string, revision: number): Conversation {
    const conversation = this.get(id)
    if (conversation.revision !== revision) throw new Error('Conversation context changed; reload before continuing')
    return conversation
  }

  private saveContext(id: string, revision: number, context: ChatContext): void {
    this.store.db.prepare('INSERT INTO chat_contexts VALUES(?,?,?,NULL,?)').run(id, revision, JSON.stringify(context), Date.now())
    for (const pod of context.pods) this.store.db.prepare('INSERT INTO chat_members VALUES(?,?,?) ON CONFLICT(conversation_id,pod_id) DO UPDATE SET name=excluded.name').run(id, pod.id, pod.name)
  }

  bind(scope: string, podId: string): void {
    const conversation = this.ensure(scope); const pod = this.store.getPod(podId)
    this.store.db.prepare('UPDATE chat_conversations SET scope=?,origin_pod=?,title=? WHERE id=?').run(podId, podId, `${pod.name} conversation`, conversation.id)
    this.store.db.prepare('UPDATE chat_contexts SET body=? WHERE conversation_id=? AND revision=?').run(JSON.stringify({ podIds: [podId], pods: [{ id: podId, name: pod.name }], workflow: null }), conversation.id, conversation.revision)
    this.store.db.prepare('INSERT OR IGNORE INTO chat_members VALUES(?,?,?)').run(conversation.id, podId, pod.name)
  }

  record(messageId: string, scope: string): void {
    const conversation = this.ensure(scope)
    this.store.db.prepare('INSERT OR IGNORE INTO chat_message_context VALUES(?,?,?)').run(messageId, conversation.id, conversation.revision)
    this.store.db.prepare('UPDATE chat_conversations SET updated_at=? WHERE id=?').run(Date.now(), conversation.id)
  }

  view(): ChatsView {
    this.ensure('')
    for (const pod of this.store.listPods()) this.ensure(pod.id)
    for (const row of this.store.db.prepare('SELECT DISTINCT scope FROM master_message_scopes UNION SELECT scope FROM master_contexts').all()) this.ensure(row.scope as string)
    const active = this.store.db.prepare('SELECT c.conversation_id FROM chat_active c JOIN master_session s ON s.id=c.id WHERE s.state=\'running\'').get()
    return { conversations: this.store.db.prepare('SELECT id FROM chat_conversations WHERE id!=? ORDER BY updated_at DESC,rowid DESC LIMIT 1000').all(codexConversationId).map(row => this.get(row.id as string)), activeConversationId: active?.conversation_id as string | null ?? null }
  }

  execute(value: ChatsCommand): ChatsView {
    const command = parseChatsCommand(value)
    if (command.type === 'list') return this.view()
    this.store.transaction(() => {
      if (command.type === 'create') {
        const context = this.snapshot(command.podIds, command.workflowId, command.workflowRevision)
        const existing = this.store.db.prepare('SELECT id FROM chat_conversations WHERE id=?').get(command.id)
        if (existing) {
          const before = this.get(command.id)
          if (before.title !== command.title || JSON.stringify(before.context) !== JSON.stringify(context)) throw new Error('Conversation identity reused with different input')
          return
        }
        if (Number(this.store.db.prepare('SELECT count(*) AS count FROM chat_conversations').get()!.count) >= 1000) throw new Error('Conversation limit reached')
        const now = Date.now()
        this.store.db.prepare('INSERT INTO chat_conversations VALUES(?,?,?,NULL,1,?,?)').run(command.id, `chat:${command.id}`, command.title.trim(), now, now)
        this.saveContext(command.id, 1, context)
        return
      }
      const conversation = this.assertRevision(command.id, command.revision)
      if (command.type === 'rename') {
        this.store.db.prepare('UPDATE chat_conversations SET title=?,updated_at=? WHERE id=?').run(command.title.trim(), Date.now(), command.id)
        return
      }
      if (this.store.db.prepare('SELECT 1 FROM master_session WHERE state=\'running\'').get()) throw new Error('Finish or stop the active response before changing context')
      const context = this.snapshot(command.podIds, command.workflowId, command.workflowRevision)
      this.store.db.prepare('UPDATE chat_contexts SET retired_thread=(SELECT thread_id FROM master_contexts WHERE scope=?) WHERE conversation_id=? AND revision=?').run(conversation.scope, command.id, command.revision)
      this.saveContext(command.id, command.revision + 1, context)
      const eventId = `context:${command.id}:${command.revision + 1}`
      this.store.db.prepare('INSERT INTO master_messages VALUES(?,\'assistant\',?,\'completed\',?)').run(eventId, `Context changed. A new model context starts here. Selected Pods: ${context.pods.map(pod => pod.name).join(', ') || 'workspace only'}. Earlier messages remain local history.`, Date.now())
      this.store.db.prepare('INSERT INTO master_message_scopes VALUES(?,?)').run(eventId, conversation.scope)
      this.store.db.prepare('INSERT INTO chat_message_context VALUES(?,?,?)').run(eventId, command.id, command.revision + 1)
      this.store.db.prepare('UPDATE chat_conversations SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(), command.id)
      this.store.db.prepare('INSERT INTO master_contexts VALUES(?,NULL,\'idle\',NULL) ON CONFLICT(scope) DO UPDATE SET thread_id=NULL,state=\'idle\',error=NULL').run(conversation.scope)
    })
    return this.view()
  }
}
