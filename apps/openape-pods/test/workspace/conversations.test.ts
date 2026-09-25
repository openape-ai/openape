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
    const first = store.createPod({ name: 'First' }); const second = store.createPod({ name: 'Second' })
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

it('adopts a creation conversation without losing its first prompt or later streamed messages', () => {
  const root = mkdtempSync(join(tmpdir(), 'pods-creation-')); const store = new PodDatabase(root)
  try {
    const conversations = new MasterConversations(store); const id = '11111111-1111-4111-8111-111111111111'
    const scope = conversations.begin(id)
    store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run('initial', 'user', 'Check every 15 minutes', 'sent', 1)
    conversations.assign('initial', scope)
    const pod = store.createPod({ name: 'Created' })
    conversations.bind(id, pod.id)
    store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run('response', 'assistant', 'Prepared', 'completed', 2)
    conversations.assign('response', scope)
    expect(conversations.messages(pod.id).map(message => message.text)).toEqual(['Check every 15 minutes', 'Prepared'])
    expect(conversations.initial(pod.id)?.text).toBe('Check every 15 minutes')
    expect(conversations.messages('')).toEqual([])
    const other = store.createPod({ name: 'Other' })
    expect(() => conversations.bind(id, other.id)).toThrow('already')
  }
  finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})
