import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { InboxStore, inboxLimits, parsePublication } from '../server/utils/inbox-store'

const cleanup: (() => void)[] = []
afterEach(() => { for (const run of cleanup.splice(0).reverse()) run() })
const owner = { issuer: 'https://owner.example', subject: 'opaque-owner' }
const other = { ...owner, subject: 'another-owner' }
const runtime = randomUUID()
const message = (eventId: string, body = 'Rechnung abgelegt.') => parsePublication({ eventId, kind: 'message', title: 'Belege', body })
function setup(path = ':memory:') {
  let now = 1_000_000
  const store = new InboxStore(path, () => now); cleanup.push(() => store.close())
  return { store, advance: (ms: number) => { now += ms } }
}

it('isolates owners and makes identical retries idempotent while changed content conflicts', () => {
  const { store } = setup()
  const first = store.publish(owner, runtime, message('run-1'))
  expect(first.created).toBe(true)
  expect(store.publish(owner, runtime, message('run-1'))).toEqual({ id: first.id, created: false })
  expect(() => store.publish(owner, runtime, message('run-1', 'Anderer Inhalt'))).toThrow('inbox_event_conflict')
  expect(store.list(owner).items.map(item => item.id)).toEqual([first.id])
  expect(store.list(other).items).toEqual([])
  expect(() => store.item(other, first.id)).toThrow('not_found')
  expect(() => store.mark(other, first.id, { read: true })).toThrow('not_found')
  expect(store.claimOutbox().map(entry => entry.itemId)).toEqual([first.id])
})

it('keeps account read/archive state and tombstones across a restart without any runtime', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pods-inbox-')); cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'inbox.sqlite')
  const { store } = setup(path)
  const kept = store.publish(owner, runtime, message('a')).id
  const removed = store.publish(owner, runtime, message('b')).id
  store.mark(owner, kept, { read: true, archived: true })
  const before = store.changes(owner, 0).cursor
  store.mark(owner, removed, { deleted: true })
  store.close(); cleanup.pop()
  const reopened = setup(path).store
  expect(reopened.list(owner).items).toEqual([])
  expect(reopened.list(owner, { archived: true }).items.map(item => [item.id, item.read !== null])).toEqual([[kept, true]])
  const delta = reopened.changes(owner, before)
  expect(delta.items.map(item => [item.id, item.deleted !== null, item.body])).toEqual([[removed, true, '']])
  expect(() => reopened.item(owner, removed)).toThrow('not_found')
})

it('revokes devices with their push subscriptions and keeps endpoints with their account', () => {
  const { store } = setup()
  const phone = store.registerDevice(owner, 'iPhone')
  const subscription = { endpoint: 'https://web.push.apple.com/abc', p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }
  store.subscribe(owner, phone.id, subscription)
  expect(() => store.subscribe(other, store.registerDevice(other, 'x').id, subscription)).toThrow('push_endpoint_taken')
  expect(store.activeDevice(other, phone.id)).toBeNull()
  store.revokeDevice(owner, phone.id)
  expect(store.activeDevice(owner, phone.id)).toBeNull()
  expect(store.subscriptions(JSON.stringify([owner.issuer, owner.subject]))).toEqual([])
  expect(() => store.revokeDevice(owner, phone.id)).toThrow('not_found')
})

it('paginates, enforces bounds and expires old messages', () => {
  const { store, advance } = setup()
  for (let index = 0; index < inboxLimits.page + 2; index++) store.publish(owner, runtime, message(`run-${index}`))
  const first = store.list(owner)
  expect(first.items).toHaveLength(inboxLimits.page)
  expect(store.list(owner, { before: first.next! }).items).toHaveLength(2)
  expect(() => parsePublication({ eventId: 'x', kind: 'message', title: 'T', body: 'x'.repeat(inboxLimits.bodyBytes + 1) })).toThrow('inbox_item_too_large')
  expect(() => parsePublication({ eventId: 'x', kind: 'message', title: 'T', body: 'B', recipient: 'someone@example.com' })).toThrow('invalid_inbox_item')
  expect(() => parsePublication({ eventId: 'x', kind: 'message', title: 'T', body: 'B', links: [{ title: 'L', url: 'http://example.com' }] })).toThrow('invalid_inbox_link')
  advance(inboxLimits.retentionMs + 1)
  expect(store.retain().expired).toBe(inboxLimits.page + 2)
  expect(store.list(owner).items).toEqual([])
})
