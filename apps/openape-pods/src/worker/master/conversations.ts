import { ChatRegistry } from './chat-registry'
import type { MasterView } from '../../contracts/master'
import type { PodDatabase } from '../storage/database'

export class MasterConversations {
  constructor(private readonly store: PodDatabase) {}
  begin(id: string): string {
    this.store.db.prepare('INSERT OR IGNORE INTO master_creations VALUES(?,NULL)').run(id)
    return `creation:${id}`
  }

  resolve(scope: string): string {
    if (!scope.startsWith('creation:')) return scope
    const row = this.store.db.prepare('SELECT pod_id FROM master_creations WHERE id=?').get(scope.slice(9))
    if (!row) throw new Error('Creation conversation not found')
    return row.pod_id as string | null ?? scope
  }

  bound(id: string): string | null {
    const scope = this.resolve(`creation:${id}`)
    return scope.startsWith('creation:') ? null : scope
  }

  bind(id: string, podId: string): void {
    this.store.getPod(podId)
    this.store.transaction(() => {
      const bound = this.bound(id)
      if (bound && bound !== podId) throw new Error('Creation conversation already belongs to another pod')
      if (bound) return
      const scope = `creation:${id}`
      const first = this.store.db.prepare('SELECT m.id FROM master_messages m JOIN master_message_scopes s ON m.id=s.message_id WHERE s.scope=? AND m.role=\'user\' ORDER BY m.rowid LIMIT 1').get(scope)
      if (!first) throw new Error('Creation conversation has no initial request')
      new ChatRegistry(this.store).bind(scope, podId)
      this.store.db.prepare('UPDATE master_creations SET pod_id=? WHERE id=?').run(podId, id)
      this.store.db.prepare('UPDATE master_message_scopes SET scope=? WHERE scope=?').run(podId, scope)
      this.store.db.prepare('UPDATE master_contexts SET scope=? WHERE scope=?').run(podId, scope)
      this.store.db.prepare('INSERT INTO pod_chat_origins VALUES(?,?)').run(podId, first.id)
    })
  }

  initial(podId: string): MasterView['messages'][number] | null {
    const row = this.store.db.prepare('SELECT m.* FROM master_messages m JOIN pod_chat_origins o ON m.id=o.message_id WHERE o.pod_id=?').get(podId)
    return row ? { id: row.id as string, role: 'user', text: row.body as string, state: row.state as string, at: row.created_at as number } : null
  }

  session(scope: string): { threadId: string | null, state: MasterView['state'], error: string | null } {
    scope = this.resolve(scope)
    new ChatRegistry(this.store).ensure(scope)
    const row = this.store.db.prepare('SELECT * FROM master_contexts WHERE scope=?').get(scope)
    return row ? { threadId: row.thread_id as string | null, state: row.state as MasterView['state'], error: row.error as string | null } : { threadId: null, state: 'idle', error: null }
  }

  capture(scope: string): void {
    scope = this.resolve(scope)
    this.store.db.prepare('INSERT INTO master_contexts SELECT ?,thread_id,state,error FROM master_session WHERE id=1 ON CONFLICT(scope) DO UPDATE SET thread_id=excluded.thread_id,state=excluded.state,error=excluded.error').run(scope)
  }

  select(scope: string): void {
    const conversation = new ChatRegistry(this.store).ensure(this.resolve(scope))
    this.store.db.prepare('UPDATE chat_active SET conversation_id=? WHERE id=1').run(conversation.id)
    const session = this.session(scope)
    this.store.db.prepare('UPDATE master_session SET thread_id=?,active_turn=NULL,state=?,error=? WHERE id=1').run(session.threadId, session.state, session.error)
  }

  assign(messageId: string, scope: string): void {
    scope = this.resolve(scope)
    this.store.db.prepare('INSERT INTO master_message_scopes VALUES(?,?) ON CONFLICT(message_id) DO NOTHING').run(messageId, scope)
    new ChatRegistry(this.store).record(messageId, scope)
  }

  messages(scope: string, before = Number.MAX_SAFE_INTEGER): MasterView['messages'] {
    scope = this.resolve(scope)
    return this.store.db.prepare('SELECT m.*,m.rowid AS sequence,c.revision AS context_revision FROM master_messages m JOIN master_message_scopes s ON s.message_id=m.id LEFT JOIN chat_message_context c ON c.message_id=m.id WHERE s.scope=? AND m.rowid<? ORDER BY m.rowid DESC LIMIT 100').all(scope, before).reverse().map(row => ({ sequence: row.sequence as number, contextRevision: row.context_revision as number | undefined, id: row.id as string, role: row.role as 'user' | 'assistant' | 'tool', text: row.body as string, state: row.state as string, at: row.created_at as number }))
  }
}
