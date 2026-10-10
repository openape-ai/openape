import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { InboxStore, parsePublication } from '../server/utils/inbox-store'
import { dispatchPushes } from '../server/utils/inbox-push'
import type { PushSend } from '../server/utils/inbox-push'

const cleanup: (() => void)[] = []
afterEach(() => { for (const run of cleanup.splice(0)) run() })
const owner = { issuer: 'https://owner.example', subject: 'opaque-owner' }
const other = { ...owner, subject: 'another-owner' }
const runtime = randomUUID()
const config = { origin: 'https://pods.example', publicKey: 'public', privateKey: 'private' }
const subscription = (name: string) => ({ endpoint: `https://web.push.apple.com/${name}`, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } })

function setup() {
  let now = 1_000_000
  const store = new InboxStore(':memory:', () => now); cleanup.push(() => store.close())
  const phone = store.registerDevice(owner, 'iPhone')
  return { store, phone, advance: (ms: number) => { now += ms } }
}
const publish = (store: InboxStore, eventId = randomUUID(), who = owner) => store.publish(who, runtime, parsePublication({ eventId, kind: 'message', title: 'IURIO PR #881: Login fix', body: 'Zwei neue Kommentare.', podId: randomUUID(), podName: 'IURIO PR monitor' }))
const outbox = (store: InboxStore) => store.db.prepare('SELECT state,attempts,result FROM outbox ORDER BY created').all().map(row => ({ ...row }))

it('sends a visible notification that opens the item and carries the account badge', async () => {
  const { store, phone } = setup()
  store.subscribe(owner, phone.id, { endpoint: subscription('phone').endpoint, p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) })
  publish(store)
  for (const entry of store.claimOutbox()) store.settleOutbox(entry.id, { state: 'sent', result: 'earlier' })
  const { id } = publish(store)
  const send = vi.fn<PushSend>(async () => ({ statusCode: 201 }))
  await dispatchPushes(store, config, send)
  expect(send).toHaveBeenCalledOnce()
  const [target, payload] = send.mock.calls[0]!
  expect(target.endpoint).toBe('https://web.push.apple.com/phone')
  expect(JSON.parse(payload)).toEqual({ web_push: 8030, mutable: true, notification: { title: 'IURIO PR monitor', body: 'IURIO PR #881: Login fix', navigate: `https://pods.example/inbox/item/${id}`, tag: id, app_badge: '2' } })
  expect(outbox(store).at(-1)).toEqual({ state: 'sent', attempts: 1, result: '201' })
  await dispatchPushes(store, config, send)
  expect(send).toHaveBeenCalledOnce()
})

it('keeps the item when nobody subscribed and never pushes another account', async () => {
  const { store } = setup()
  store.subscribe(other, store.registerDevice(other, 'x').id, { endpoint: subscription('other').endpoint, p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) })
  publish(store)
  const send = vi.fn<PushSend>(async () => ({ statusCode: 201 }))
  await dispatchPushes(store, config, send)
  expect(send).not.toHaveBeenCalled()
  expect(outbox(store)).toEqual([{ state: 'failed', attempts: 1, result: 'no_subscription' }])
  expect(store.badgeCount(owner)).toBe(1)
})

it('removes expired subscriptions and retries temporary push service failures with backoff', async () => {
  const { store, phone, advance } = setup()
  const tablet = store.registerDevice(owner, 'iPad')
  store.subscribe(owner, phone.id, { endpoint: subscription('gone').endpoint, p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) })
  store.subscribe(owner, tablet.id, { endpoint: subscription('busy').endpoint, p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) })
  publish(store)
  const send = vi.fn<PushSend>(async (target) => { throw Object.assign(new Error('push failed'), { statusCode: target.endpoint.endsWith('gone') ? 410 : 503 }) })
  await dispatchPushes(store, config, send)
  expect(store.subscriptions(JSON.stringify([owner.issuer, owner.subject])).map(entry => entry.endpoint)).toEqual(['https://web.push.apple.com/busy'])
  expect(outbox(store)).toEqual([{ state: 'pending', attempts: 1, result: '410,503' }])
  await dispatchPushes(store, config, send)
  expect(send).toHaveBeenCalledTimes(2)
  for (const delay of [30_000, 120_000, 600_000, 3_600_000]) { advance(delay); await dispatchPushes(store, config, send) }
  expect(outbox(store)).toEqual([{ state: 'failed', attempts: 5, result: '503' }])
})

it('drops the push of an item deleted before dispatch', async () => {
  const { store, phone } = setup()
  store.subscribe(owner, phone.id, { endpoint: subscription('phone').endpoint, p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) })
  const { id } = publish(store)
  store.db.prepare('UPDATE items SET deleted=1 WHERE id=?').run(id)
  const send = vi.fn<PushSend>(async () => ({ statusCode: 201 }))
  await dispatchPushes(store, config, send)
  expect(send).not.toHaveBeenCalled()
  expect(outbox(store)).toEqual([{ state: 'failed', attempts: 1, result: 'item_gone' }])
})
