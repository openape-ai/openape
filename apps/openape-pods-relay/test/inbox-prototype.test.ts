import { afterEach, expect, it } from 'vitest'
import { InboxPrototype, parseSubscription } from '../server/utils/inbox-prototype'

const cleanup: (() => void)[] = []
afterEach(() => { for (const run of cleanup.splice(0)) run() })
const owner = { issuer: 'https://owner.example', subject: 'opaque-owner' }
const other = { ...owner, subject: 'another-owner' }
const subscription = { endpoint: 'https://web.push.apple.com/QGuQyavXutnMH', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }
function setup() {
  let now = 1_000_000
  const store = new InboxPrototype(':memory:', () => now); cleanup.push(() => store.close())
  return { store, advance: (ms: number) => { now += ms } }
}

it('persists the item before dispatch and claims every due push exactly once', () => {
  const { store, advance } = setup()
  store.schedule(owner, [1_000_000, 1_060_000])
  const first = store.claimDue()
  expect(first).toHaveLength(1)
  expect(store.item(owner, first[0]!.item.id).kind).toBe('decision')
  expect(store.claimDue()).toHaveLength(0)
  advance(60_000)
  expect(store.claimDue().map(due => due.item.kind)).toEqual(['message'])
})

it('isolates owners and keeps the first decision', () => {
  const { store } = setup()
  store.schedule(owner, [1_000_000])
  const [due] = store.claimDue()
  const id = due!.item.id
  expect(() => store.item(other, id)).toThrow('not_found')
  expect(() => store.decide(other, id, 'Ablegen')).toThrow('not_found')
  expect(() => store.decide(owner, id, 'Löschen')).toThrow('invalid_choice')
  expect(store.decide(owner, id, 'Verwerfen').outcome).toBe('Verwerfen')
  expect(store.decide(owner, id, 'Ablegen').outcome).toBe('Verwerfen')
  store.opened(other, due!.push.id, id)
  expect(store.push(due!.push.id)?.opened).toBeNull()
})

it('records receipts only for the secret token and refuses foreign push endpoints', () => {
  const { store } = setup()
  store.schedule(owner, [1_000_000])
  const [due] = store.claimDue()
  expect(store.receipt('wrong', 'shown')).toBe(false)
  expect(store.receipt(due!.push.token, 'shown')).toBe(true)
  expect(store.push(due!.push.id)?.shown).toBe(1_000_000)
  expect(parseSubscription(subscription).endpoint).toBe(subscription.endpoint)
  for (const endpoint of ['http://web.push.apple.com/x', 'https://127.0.0.1/x', 'https://web.push.apple.com.evil.example/x', 'https://web.push.apple.com:8443/x']) {
    expect(() => parseSubscription({ ...subscription, endpoint })).toThrow('invalid_push_endpoint')
  }
  expect(() => store.schedule(owner, [1_000_000 + 4 * 86400000])).toThrow('invalid_schedule')
})
