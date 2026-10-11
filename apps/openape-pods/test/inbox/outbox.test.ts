// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { InboxOutbox, parseNotify } from '../../src/worker/inbox/outbox'
import type { InboxPublication } from '../../src/worker/inbox/outbox'
import { parseFrame } from '../../src/contracts/runs'
import { PodDatabase } from '../../src/worker/storage/database'
import { ItemTagStore } from '../../src/worker/workspace/item-tags'
import { seedNetwork } from '../storage/network-fixture'

const stores: PodDatabase[] = []; const roots: string[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-inbox-outbox-')); roots.push(root)
  let now = 1_000_000
  const store = new PodDatabase(root); stores.push(store)
  const pod = store.createPod({ name: 'Belege' })
  return { root, store, pod, outbox: new InboxOutbox(store, () => now), advance: (ms: number) => { now += ms } }
}
const message = { key: 'invoice-42', title: 'Rechnung abgelegt', body: 'Rechnung 42 liegt im Archiv.' }

it('queues one durable message per key across retried runs and refuses changed content', () => {
  const { root, store, pod, outbox } = fixture()
  expect(outbox.queue(pod, randomUUID(), parseNotify(message))).toEqual({ eventId: `${pod.id}:invoice-42`, queued: true })
  expect(outbox.queue(pod, randomUUID(), parseNotify(message))).toEqual({ eventId: `${pod.id}:invoice-42`, queued: false })
  expect(() => outbox.queue(pod, randomUUID(), parseNotify({ ...message, body: 'Anders' }))).toThrow('already used with different content')
  store.close(); stores.pop()
  const reopened = new PodDatabase(root); stores.push(reopened)
  const due = new InboxOutbox(reopened).execute({ type: 'due' }) as InboxPublication[]
  expect(due).toMatchObject([{ eventId: `${pod.id}:invoice-42`, kind: 'message', title: 'Rechnung abgelegt', podId: pod.id, podName: 'Belege' }])
})

it('snapshots the Pod tags, own before inherited, when a message is queued (issue 1461)', () => {
  const root = mkdtempSync(join(tmpdir(), 'pods-inbox-outbox-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store)
  const seeded = seedNetwork(store)
  const tags = new ItemTagStore(store)
  tags.execute({ type: 'tag', id: seeded.networkId, revision: 0, tags: ['delta-mind', 'mail'] })
  tags.execute({ type: 'tag', id: seeded.pod.id, revision: 0, tags: ['intake', 'mail'] })
  const outbox = new InboxOutbox(store)
  outbox.queue(seeded.pod, randomUUID(), parseNotify(message))
  // A later tag change leaves the queued publication unchanged, so its retries stay identical.
  tags.execute({ type: 'tag', id: seeded.pod.id, revision: 1, tags: [] })
  const untagged = store.createPod({ name: 'Ohne Tags' })
  outbox.queue(untagged, randomUUID(), parseNotify(message))
  const due = outbox.execute({ type: 'due' }) as InboxPublication[]
  expect(due.map(item => [item.podId, item.podTags])).toEqual([[seeded.pod.id, ['intake', 'mail', 'delta-mind']], [untagged.id, undefined]])
  expect(due[1]).not.toHaveProperty('podTags')
})

it('retries uncertain deliveries with backoff and keeps refusals and receipts final', () => {
  const { pod, outbox, advance } = fixture()
  const { eventId } = outbox.queue(pod, randomUUID(), parseNotify(message))
  outbox.execute({ type: 'settle', eventId, outcome: { state: 'retry', reason: 'network' } })
  expect(outbox.execute({ type: 'due' })).toEqual([])
  advance(30000)
  expect((outbox.execute({ type: 'due' }) as InboxPublication[]).map(item => item.eventId)).toEqual([eventId])
  outbox.execute({ type: 'settle', eventId, outcome: { state: 'delivered', itemId: randomUUID() } })
  outbox.execute({ type: 'settle', eventId, outcome: { state: 'refused', reason: 'late' } })
  expect(outbox.execute({ type: 'status' })).toEqual({ pending: 0, refused: [] })
  const other = outbox.queue(pod, randomUUID(), parseNotify({ ...message, key: 'b' })).eventId
  outbox.execute({ type: 'settle', eventId: other, outcome: { state: 'refused', reason: 'inbox_event_conflict' } })
  expect(outbox.execute({ type: 'status' })).toEqual({ pending: 0, refused: [{ eventId: other, reason: 'inbox_event_conflict' }] })
})

it('refuses recipients, oversized bodies and unsafe links before queueing, and is an allowed script operation', () => {
  expect(() => parseNotify({ ...message, recipient: 'someone@example.com' })).toThrow('recipient is always the Pod owner')
  expect(() => parseNotify({ ...message, chatId: 1 })).toThrow()
  expect(() => parseNotify({ ...message, body: 'x'.repeat(64 * 1024 + 1) })).toThrow('64 KiB')
  expect(() => parseNotify({ ...message, links: [{ title: 'L', url: 'http://example.com' }] })).toThrow('https')
  expect(() => parseNotify({ ...message, key: 'has space' })).toThrow('notify key')
  expect(parseFrame({ version: 1, runId: 'run', sequence: 1, type: 'request', id: 'request-1', operation: 'notify', payload: message }, 'run', 1).operation).toBe('notify')
})
