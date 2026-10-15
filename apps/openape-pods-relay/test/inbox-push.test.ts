import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { InboxStore, inboxLimits, parsePublication } from '../server/utils/inbox-store'
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

const decision = (sourceId: string) => ({ sourceId, type: 'question' as const, digest: 'a'.repeat(64), podId: null, podName: null, title: 'Classify mail', body: 'Mail excerpt', authority: 'pods' as const, options: [{ key: 'keep', title: 'Keep', input: 'none' as const }], link: null })
const subscribe = (store: InboxStore, deviceId: string, who = owner) => store.subscribe(who, deviceId, { endpoint: subscription(deviceId).endpoint, p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) })

it('coalesces a hundred decisions across syncs into one push per device after quiet time', async () => {
  const { store, phone, advance } = setup()
  subscribe(store, phone.id)
  subscribe(store, store.registerDevice(owner, 'tablet').id)
  const decisions = Array.from({ length: 100 }, (_, index) => decision(`question:${index}`))
  store.syncDecisions(owner, runtime, decisions.slice(0, 50))
  const send = vi.fn<PushSend>(async () => ({ statusCode: 201 }))
  advance(90_000)
  store.syncDecisions(owner, runtime, decisions)
  advance(90_000)
  await dispatchPushes(store, config, send)
  expect(send).not.toHaveBeenCalled()
  // All items are actionable during collection; the normal page size does not limit the push group.
  expect(store.badgeCount(owner)).toBe(100)
  advance(30_000)
  await dispatchPushes(store, config, send)
  expect(send).toHaveBeenCalledTimes(2)
  expect(JSON.parse(send.mock.calls[0]![1]).notification).toMatchObject({ title: '100 neue Entscheidungen', navigate: 'https://pods.example/inbox/', tag: 'pods-decisions', app_badge: '100' })
  expect(outbox(store)).toHaveLength(100)
  expect(outbox(store).every(entry => entry.state === 'sent')).toBe(true)
  await dispatchPushes(store, config, send)
  expect(send).toHaveBeenCalledTimes(2)
})

it('bounds continuous collection at ten minutes and isolates accounts', async () => {
  const { store, phone, advance } = setup()
  subscribe(store, phone.id)
  const otherPhone = store.registerDevice(other, 'other phone')
  subscribe(store, otherPhone.id, other)
  const send = vi.fn<PushSend>(async () => ({ statusCode: 201 }))
  const decisions = [decision('question:0')]
  store.syncDecisions(owner, runtime, decisions)
  for (let index = 1; index < 10; index++) {
    advance(60_000); decisions.push(decision(`question:${index}`))
    store.syncDecisions(owner, runtime, decisions)
    await dispatchPushes(store, config, send)
  }
  expect(send).not.toHaveBeenCalled()
  advance(60_000); decisions.push(decision('question:10'))
  store.syncDecisions(owner, runtime, decisions)
  store.syncDecisions(other, runtime, [decision('question:private')])
  // No quiet time elapsed, but the maximum wait has expired for the first account.
  await dispatchPushes(store, config, send)
  expect(send).toHaveBeenCalledOnce()
  expect(send.mock.calls[0]![0].endpoint).toBe(subscription(phone.id).endpoint)
  expect(JSON.parse(send.mock.calls[0]![1]).notification.app_badge).toBe('11')
  advance(120_000)
  await dispatchPushes(store, config, send)
  expect(send).toHaveBeenCalledTimes(2)
  expect(send.mock.calls[1]![0].endpoint).toBe(subscription(otherPhone.id).endpoint)
  expect(JSON.parse(send.mock.calls[1]![1]).notification.app_badge).toBe('1')
})

it('retries a decision digest as one group and suppresses decisions resolved during backoff', async () => {
  const { store, phone, advance } = setup()
  subscribe(store, phone.id)
  store.syncDecisions(owner, runtime, [decision('question:a'), decision('question:b')])
  advance(inboxLimits.decisionQuietMs)
  const send = vi.fn<PushSend>().mockRejectedValueOnce(Object.assign(new Error('busy'), { statusCode: 503 })).mockResolvedValue({ statusCode: 201 })
  await dispatchPushes(store, config, send)
  expect(send).toHaveBeenCalledOnce()
  store.syncDecisions(owner, runtime, [decision('question:b')])
  await dispatchPushes(store, config, send)
  expect(send).toHaveBeenCalledOnce()
  advance(30_000)
  await dispatchPushes(store, config, send)
  expect(send).toHaveBeenCalledTimes(2)
  expect(JSON.parse(send.mock.calls[1]![1]).notification).toMatchObject({ title: 'Entscheidung wartet', app_badge: '1' })
  store.syncDecisions(owner, runtime, [decision('question:c')])
  store.syncDecisions(owner, runtime, [])
  advance(inboxLimits.decisionQuietMs)
  await dispatchPushes(store, config, send)
  expect(send).toHaveBeenCalledTimes(2)
})
