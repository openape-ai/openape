import { ChatRegistry } from './chat-registry'
import type { MasterView } from '../../contracts/master'
import type { PodDatabase } from '../storage/database'

export class MasterConversations {
  constructor(private readonly store: PodDatabase) {}
  resolve(scope: string): string {
    if (!scope.startsWith('creation:')) return scope
    const row = this.store.db.prepare('SELECT pod_id FROM master_creations WHERE id=?').get(scope.slice(9))
    if (!row) throw new Error('Creation conversation not found')
    return row.pod_id as string | null ?? scope
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
