import { ChatRegistry } from './chat-registry'
import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'

import type { AdoptionPreview } from '../../contracts/description'

export class LegacyChatAdoption {
  constructor(private readonly store: PodDatabase) {}

  preview(podId: string): AdoptionPreview | null {
    this.store.getPod(podId)
    if (this.store.db.prepare('SELECT 1 FROM master_message_scopes WHERE scope=?').get(podId)) return null
    const creation = this.store.db.prepare('SELECT a.id FROM master_actions a WHERE a.state=\'completed\' AND json_extract(a.request,\'$.action\')=\'create\' AND json_extract(a.result,\'$.id\')=?').all(podId)
    if (creation.length !== 1) return null
    const event = this.store.db.prepare('SELECT m.rowid AS sequence FROM master_messages m JOIN master_message_scopes s ON m.id=s.message_id WHERE m.id=? AND s.scope=\'\'').get(`tool:${creation[0].id as string}`)
    if (!event) return null
    const first = this.store.db.prepare('SELECT m.rowid AS sequence FROM master_messages m JOIN master_message_scopes s ON m.id=s.message_id WHERE s.scope=\'\' AND m.role=\'user\' AND m.rowid<? ORDER BY m.rowid DESC LIMIT 1').get(event.sequence)
    if (!first) return null
    const rows = this.store.db.prepare('SELECT m.* FROM master_messages m JOIN master_message_scopes s ON m.id=s.message_id WHERE s.scope=\'\' AND m.rowid>=? ORDER BY m.rowid LIMIT 501').all(first.sequence)
    if (!rows.length || rows.length > 500 || rows.some(row => ['streaming', 'sending', 'uncertain'].includes(row.state as string))) return null
    for (const row of rows.filter(row => row.role === 'tool')) {
      const action = this.store.db.prepare('SELECT request,result,state FROM master_actions WHERE id=?').get((row.id as string).slice(5))
      const failed = !action && row.state === 'failed' ? JSON.parse(row.body as string) as { request?: { podId?: string, action?: string } } : null
      if (!action && !failed?.request) return null
      const request = action ? JSON.parse(action.request as string) as { podId?: string, action: string } : failed!.request!
      if (request.podId && request.podId !== podId) return null
      if (request.action === 'create' && action?.state === 'completed' && (JSON.parse(action.result as string) as { id?: string }).id !== podId) return null
    }
    return { hash: digest(JSON.stringify({ podId, rows })), firstMessageId: rows[0].id as string, lastMessageId: rows.at(-1)!.id as string, requests: rows.filter(row => row.role === 'user').map(row => ({ id: row.id as string, text: row.body as string })), messageCount: rows.length }
  }

  adopt(podId: string, hash: string): void {
    this.store.transaction(() => {
      if (this.store.db.prepare('SELECT 1 FROM master_session WHERE state=\'running\'').get()) throw new Error('Finish the active chat before recovering history')
      const preview = this.preview(podId)
      if (!preview || preview.hash !== hash) throw new Error('Creation history changed or is ambiguous; review it again')
      const first = this.store.db.prepare('SELECT rowid AS sequence FROM master_messages WHERE id=?').get(preview.firstMessageId)!
      const last = this.store.db.prepare('SELECT rowid AS sequence FROM master_messages WHERE id=?').get(preview.lastMessageId)!
      this.store.db.prepare('UPDATE master_message_scopes SET scope=? WHERE scope=\'\' AND message_id IN (SELECT id FROM master_messages WHERE rowid BETWEEN ? AND ?)').run(podId, first.sequence, last.sequence)
      const conversation = new ChatRegistry(this.store).ensure(podId)
      this.store.db.prepare('UPDATE chat_message_context SET conversation_id=?,revision=1 WHERE message_id IN (SELECT message_id FROM master_message_scopes WHERE scope=?)').run(conversation.id, podId)
      this.store.db.prepare('INSERT INTO pod_chat_origins VALUES(?,?)').run(podId, preview.firstMessageId)
      const other = this.store.db.prepare('SELECT 1 FROM master_message_scopes WHERE scope=\'\' LIMIT 1').get()
      if (!other) this.store.db.prepare('UPDATE master_contexts SET scope=? WHERE scope=\'\' ').run(podId)
    })
  }
}
