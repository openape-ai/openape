// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { MasterConversations } from '../../src/worker/master/conversations'

it('keeps legacy and per-pod history and continuation IDs separate after reopening', () => {
  const root = mkdtempSync(join(tmpdir(), 'pods-conversations-')); let store = new PodDatabase(root)
  try {
    const first = store.createPod({ name: 'First', assignment: 'Read' }); const second = store.createPod({ name: 'Second', assignment: 'Read' })
    const conversations = new MasterConversations(store)
    for (const [id, scope] of [['one', first.id], ['two', second.id], ['legacy', '']]) {
      store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run(id, 'user', id, 'sent', 1)
      conversations.assign(id, scope)
    }
    conversations.select(first.id); store.db.prepare('UPDATE master_session SET thread_id=\'first-thread\',state=\'idle\' WHERE id=1').run(); conversations.capture(first.id)
    conversations.select(second.id); expect(store.db.prepare('SELECT thread_id FROM master_session WHERE id=1').get()!.thread_id).toBeNull()
    store.close(); store = new PodDatabase(root)
    const reopened = new MasterConversations(store)
    expect(reopened.messages(first.id).map(message => message.text)).toEqual(['one'])
    expect(reopened.messages(second.id).map(message => message.text)).toEqual(['two'])
    expect(reopened.messages('').map(message => message.text)).toEqual(['legacy'])
    expect(reopened.session(first.id).threadId).toBe('first-thread')
    expect(reopened.session(second.id).threadId).toBeNull()
  }
  finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})
