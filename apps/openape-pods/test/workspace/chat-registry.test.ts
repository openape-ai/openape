// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ChatRegistry } from '../../src/worker/master/chat-registry'
import { MasterConversations } from '../../src/worker/master/conversations'

const roots: string[] = []; const stores: PodDatabase[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-chat-registry-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store)
  return { store, chats: new ChatRegistry(store) }
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('keeps two conversations for one Pod separate and starts a fresh context without deleting history', () => {
  const { store, chats } = fixture(); const pod = store.createPod({ name: 'Filter' })
  const first = randomUUID(); const second = randomUUID()
  for (const id of [first, second]) chats.execute({ type: 'create', id, title: 'Review', podIds: [pod.id] })
  const before = chats.get(first); const conversations = new MasterConversations(store)
  store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run('message', 'user', 'Original request', 'sent', 1)
  conversations.assign('message', before.scope)
  store.db.prepare('INSERT INTO master_contexts VALUES(?,\'previous-thread\',\'idle\',NULL)').run(before.scope)
  chats.execute({ type: 'context', id: first, revision: 1, podIds: [] })
  expect(chats.get(first)).toMatchObject({ revision: 2, context: { pods: [] }, relatedPodIds: [pod.id] })
  expect(conversations.session(before.scope).threadId).toBeNull()
  expect(conversations.messages(before.scope)[0]?.text).toBe('Original request')
  expect(conversations.messages(chats.get(second).scope)).toEqual([])
  expect(() => chats.execute({ type: 'context', id: first, revision: 1, podIds: [pod.id] })).toThrow('changed')
})

it('paginates every message in stable order even when timestamps are equal', () => {
  const { store, chats } = fixture(); const chat = chats.ensure(''); const conversations = new MasterConversations(store)
  store.transaction(() => {
    for (let index = 0; index < 205; index++) {
      store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run(`page-${index}`, 'user', `Message ${index}`, 'sent', 1)
      conversations.assign(`page-${index}`, chat.scope)
    }
  })
  let messages = conversations.messages(chat.scope)
  while (true) {
    const older = conversations.messages(chat.scope, messages[0]!.sequence)
    if (!older.length) break
    messages = [...older, ...messages]
  }
  expect(messages.map(message => message.text)).toEqual(Array.from({ length: 205 }, (_, index) => `Message ${index}`))
  expect(new Set(messages.map(message => message.id)).size).toBe(205)
})
