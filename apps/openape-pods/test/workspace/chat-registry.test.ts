import { removeRemoteSchema } from '../storage/legacy'
// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ChatRegistry } from '../../src/worker/master/chat-registry'
import { MasterConversations } from '../../src/worker/master/conversations'
import { WorkflowEngine } from '../../src/worker/workflows/engine'
import { parseChatsCommand } from '../../src/contracts/chats'

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
  for (const id of [first, second]) chats.execute({ type: 'create', id, title: 'Review', podIds: [pod.id], workflowId: null, workflowRevision: null })
  const before = chats.get(first); const conversations = new MasterConversations(store)
  store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run('message', 'user', 'Original request', 'sent', 1)
  conversations.assign('message', before.scope); conversations.select(before.scope)
  store.db.prepare('UPDATE master_session SET thread_id=\'previous-thread\'').run(); conversations.capture(before.scope)
  chats.execute({ type: 'context', id: first, revision: 1, podIds: [], workflowId: null, workflowRevision: null })
  expect(chats.get(first)).toMatchObject({ revision: 2, context: { pods: [] }, relatedPodIds: [pod.id] })
  expect(conversations.session(before.scope).threadId).toBeNull()
  expect(conversations.messages(before.scope)[0]?.text).toBe('Original request')
  expect(conversations.messages(chats.get(second).scope)).toEqual([])
  expect(store.db.prepare('SELECT retired_thread FROM chat_contexts WHERE conversation_id=? AND revision=1').get(first)?.retired_thread).toBe('previous-thread')
  expect(() => chats.execute({ type: 'context', id: first, revision: 1, podIds: [pod.id], workflowId: null, workflowRevision: null })).toThrow('changed')
})

it('pins workflow membership without modifying Pods and requires deliberate refresh', () => {
  const { store, chats } = fixture(); const one = store.createPod({ name: 'Filter' }); const two = store.createPod({ name: 'Report' })
  const engine = new WorkflowEngine(store, { start: () => 'unused', cancelPod: () => {} }, { inspect: async () => {} })
  const workflowId = randomUUID(); const nodes = [{ podId: one.id, after: [], handoff: false }]
  engine.save({ type: 'save', id: workflowId, revision: 0, name: 'Mail', nodes, schedule: null, enabled: false })
  const id = randomUUID(); chats.execute({ type: 'create', id, title: 'Mail', podIds: [], workflowId, workflowRevision: 1 })
  engine.save({ type: 'save', id: workflowId, revision: 1, name: 'Mail', nodes: [...nodes, { podId: two.id, after: [one.id], handoff: false }], schedule: null, enabled: false })
  expect(chats.get(id)).toMatchObject({ workflowChanged: true, context: { pods: [{ id: one.id }] } })
  chats.execute({ type: 'context', id, revision: 1, podIds: [], workflowId, workflowRevision: 2 })
  expect(chats.get(id).context.pods.map(pod => pod.id)).toEqual([one.id, two.id])
  expect(store.getPod(one.id)).toEqual(one); expect(store.getPod(two.id)).toEqual(two)
})

it('refuses context changes during a model turn and forged fields at the boundary', () => {
  const { store, chats } = fixture(); const conversation = chats.ensure('')
  store.db.prepare('UPDATE master_session SET state=\'running\'').run()
  expect(() => chats.execute({ type: 'context', id: conversation.id, revision: 1, podIds: [], workflowId: null, workflowRevision: null })).toThrow('active response')
  expect(() => parseChatsCommand({ type: 'list', approved: true })).toThrow('fields')
})

it('migrates legacy messages and creation origins without losing content or restoring broad workspace authority', () => {
  const { store } = fixture(); const pod = store.createPod({ name: 'Legacy' }); const creation = randomUUID()
  store.db.prepare('INSERT INTO master_creations VALUES(?,?)').run(creation, pod.id)
  for (let index = 0; index < 125; index++) {
    store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run(`m${index}`, 'user', `Text ${index}`, 'sent', index)
    store.db.prepare('INSERT INTO master_message_scopes VALUES(?,?)').run(`m${index}`, index % 2 ? pod.id : '')
  }
  store.db.prepare('INSERT INTO pod_chat_origins VALUES(?,?)').run(pod.id, 'm1')
  store.db.prepare('INSERT OR REPLACE INTO master_contexts VALUES(?,?,?,?)').run('', 'broad-thread', 'idle', null)
  store.db.prepare('INSERT OR REPLACE INTO master_contexts VALUES(?,?,?,?)').run(pod.id, 'pod-thread', 'idle', null)
  const before = store.db.prepare('SELECT * FROM master_messages ORDER BY rowid').all()
  removeRemoteSchema(store.db)
  for (const row of store.db.prepare('SELECT name FROM sqlite_schema WHERE type=\'table\' AND (name LIKE \'chat_%\' OR name IN (\'control_changes\',\'control_runs\')) ORDER BY rowid DESC').all()) store.db.exec(`DROP TABLE ${row.name}`)
  store.db.exec('ALTER TABLE pod_descriptions DROP COLUMN manual; PRAGMA user_version=20'); const root = store.root; store.close(); stores.splice(stores.indexOf(store), 1)
  const migrated = new PodDatabase(root); stores.push(migrated)
  expect(migrated.db.prepare('SELECT * FROM master_messages ORDER BY rowid').all()).toEqual(before)
  const registry = new ChatRegistry(migrated)
  expect(registry.view().conversations).toHaveLength(2)
  expect(migrated.db.prepare('SELECT count(*) AS count FROM chat_message_context').get()?.count).toBe(125)
  expect(new MasterConversations(migrated).session('').threadId).toBeNull()
  expect(new MasterConversations(migrated).session(pod.id).threadId).toBe('pod-thread')
  expect(new MasterConversations(migrated).initial(pod.id)?.id).toBe('m1')
})

it('paginates every message in stable order even when timestamps are equal', () => {
  const { store, chats } = fixture(); const chat = chats.ensure(''); const conversations = new MasterConversations(store)
  for (let index = 0; index < 205; index++) {
    store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run(`page-${index}`, 'user', `Message ${index}`, 'sent', 1)
    conversations.assign(`page-${index}`, chat.scope)
  }
  let messages = conversations.messages(chat.scope)
  while (true) {
    const older = conversations.messages(chat.scope, messages[0]!.sequence)
    if (!older.length) break
    messages = [...older, ...messages]
  }
  expect(messages.map(message => message.text)).toEqual(Array.from({ length: 205 }, (_, index) => `Message ${index}`))
  expect(new Set(messages.map(message => message.id)).size).toBe(205)
})
