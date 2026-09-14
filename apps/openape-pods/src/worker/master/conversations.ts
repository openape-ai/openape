import type { MasterView } from '../../contracts/master'
import type { PodDatabase } from '../storage/database'

export class MasterConversations {
  constructor(private readonly store: PodDatabase) {}
  session(scope: string): { threadId: string | null, state: MasterView['state'], error: string | null } {
    if (scope) this.store.getPod(scope)
    const row = this.store.db.prepare('SELECT * FROM master_contexts WHERE scope=?').get(scope)
    return row ? { threadId: row.thread_id as string | null, state: row.state as MasterView['state'], error: row.error as string | null } : { threadId: null, state: 'idle', error: null }
  }

  capture(scope: string): void {
    this.store.db.prepare('INSERT INTO master_contexts SELECT ?,thread_id,state,error FROM master_session WHERE id=1 ON CONFLICT(scope) DO UPDATE SET thread_id=excluded.thread_id,state=excluded.state,error=excluded.error').run(scope)
  }

  select(scope: string): void {
    const session = this.session(scope)
    this.store.db.prepare('UPDATE master_session SET thread_id=?,active_turn=NULL,state=?,error=? WHERE id=1').run(session.threadId, session.state, session.error)
  }

  assign(messageId: string, scope: string): void {
    this.store.db.prepare('INSERT INTO master_message_scopes VALUES(?,?) ON CONFLICT(message_id) DO NOTHING').run(messageId, scope)
  }

  messages(scope: string): MasterView['messages'] {
    return this.store.db.prepare('SELECT m.* FROM master_messages m JOIN master_message_scopes s ON s.message_id=m.id WHERE s.scope=? ORDER BY m.created_at DESC,m.rowid DESC LIMIT 100').all(scope).reverse().map(row => ({ id: row.id as string, role: row.role as 'user' | 'assistant' | 'tool', text: row.body as string, state: row.state as string, at: row.created_at as number }))
  }
}
