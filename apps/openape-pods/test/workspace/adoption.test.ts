// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { MasterConversations } from '../../src/worker/master/conversations'
import { LegacyChatAdoption } from '../../src/worker/master/adoption'

it('recovers the reviewed creation history, preserves timestamps and rejects stale or mixed history', () => {
  const root = mkdtempSync(join(tmpdir(), 'pod-adoption-')); const store = new PodDatabase(root)
  try {
    const pod = store.createPod({ name: 'Existing' }); const conversations = new MasterConversations(store)
    const message = (id: string, role: string, text: string) => { store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run(id, role, text, role === 'user' ? 'sent' : 'completed', 123); conversations.assign(id, '') }
    message('start', 'user', 'Original request')
    const request = { action: 'create', name: pod.name }
    store.db.prepare('INSERT INTO master_actions VALUES(?,?,?,?,?,NULL)').run('create', 'hash', JSON.stringify(request), 'completed', JSON.stringify(pod))
    message('tool:create', 'tool', JSON.stringify({ request, result: pod }))
    message('answer', 'assistant', 'Created')
    const adoption = new LegacyChatAdoption(store); const first = adoption.preview(pod.id)!
    message('correction', 'user', 'Correction')
    expect(() => adoption.adopt(pod.id, first.hash)).toThrow('changed')
    const reviewed = adoption.preview(pod.id)!
    expect(reviewed.requests.map(request => request.text)).toEqual(['Original request', 'Correction'])
    const other = store.createPod({ name: 'Other' })
    store.db.prepare('INSERT INTO master_actions VALUES(?,?,?,?,?,NULL)').run('other', 'other', JSON.stringify({ action: 'inspect', podId: other.id }), 'completed', '{}')
    message('tool:other', 'tool', '{}')
    expect(adoption.preview(pod.id)).toBeNull()
    store.db.prepare('DELETE FROM master_messages WHERE id=?').run('tool:other')
    adoption.adopt(pod.id, reviewed.hash)
    expect(conversations.initial(pod.id)).toMatchObject({ text: 'Original request', at: 123 })
    expect(conversations.messages(pod.id)).toHaveLength(4)
    expect(store.getPod(pod.id)).toEqual(pod)
    expect(adoption.preview(pod.id)).toBeNull()
  }
  finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})
