import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { generateKey, publicKey, seal } from '@openape/pods-protocol/crypto'
import { capabilities } from '@openape/pods-protocol'
import type { Owner, Route } from '@openape/pods-protocol'
import { RelayStore } from '../server/utils/store'
import { RuntimeHub } from '../server/utils/hub'
import { Notifier } from '../server/utils/notifications'
import type { PushRequest, PushResponse } from '../server/utils/notifications'

const stores: RelayStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
const apnsKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const marker = `private-${randomUUID()}`

function fixture(respond: (request: PushRequest) => PushResponse = () => ({ status: 200 })) {
  let now = Date.parse('2026-10-06T12:00:00.000Z')
  const store = new RelayStore(':memory:', () => now); stores.push(store)
  const owner: Owner = { issuer: 'https://id.example', subject: 'owner@example.test' }
  const deviceKey = generateKey(); const runtimeKey = generateKey()
  const device = store.register(randomUUID(), owner, 'mobile', { signing: publicKey(deviceKey), agreement: publicKey(deviceKey) })
  const runtime = store.register(randomUUID(), owner, 'runtime', { signing: publicKey(runtimeKey), agreement: publicKey(runtimeKey) })
  store.pair(runtime, device.id)
  const sent: PushRequest[] = []
  const notifier = new Notifier(store, { enabled: true, keyId: 'KEY1234567', teamId: 'Q994DN23WB', key: apnsKey, bundle: 'ai.openape.pods', host: 'api.push.apple.com', sandboxHost: 'api.sandbox.push.apple.com' }, async (request) => { sent.push(request); return respond(request) })
  const hub = new RuntimeHub(store, notifier)
  const peer = { id: 'desktop', send: () => {}, close: () => {} }
  hub.connect(peer, store.issue(runtime.id).accessToken, capabilities)
  const event = () => {
    const route: Route = { protocol: 'pods-mobile', major: 1, minor: 0, id: randomUUID(), runtimeId: runtime.id, generation: runtime.generation, deviceId: device.id, keyEpoch: 1, owner, direction: 'event', kind: 'snapshot', kindVersion: 1, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString(), sequence: '1' }
    return seal(route, { text: marker }, device.keys.agreement, runtimeKey)
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  return { store, device, runtime, hub, peer, sent, event, settle, advance: (ms: number) => { now += ms } }
}

it('sends one content-free hint per runtime for a device that is not polling', async () => {
  const { store, device, runtime, hub, peer, sent, event, settle, advance } = fixture()
  store.registerPush(device, 'ab'.repeat(32), 'production')
  hub.deliver(peer.id, event()); await settle()
  expect(sent).toHaveLength(1)
  const request = sent[0]!
  expect(request.host).toBe('api.push.apple.com')
  expect(request.path).toBe(`/3/device/${'ab'.repeat(32)}`)
  expect(request.headers['apns-topic']).toBe('ai.openape.pods')
  expect(request.headers['apns-collapse-id']).toBe(runtime.id)
  expect(request.headers['apns-push-type']).toBe('alert')
  expect(request.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/)
  expect(request.body.includes(marker)).toBe(false)
  expect(request.body.includes(device.id)).toBe(false)
  expect(JSON.parse(request.body)).toEqual({ aps: { 'alert': { title: 'OpenApe Pods', body: 'A Pod on your desktop has an update.' }, 'thread-id': runtime.id, 'sound': 'default' }, runtime: runtime.id })
  // A second event within a minute collapses into the first hint.
  hub.deliver(peer.id, event()); await settle()
  expect(sent).toHaveLength(1)
  // Heartbeats keep the desktop socket alive while the clock passes the repeat window.
  advance(30000); hub.heartbeat(peer.id); advance(31000); hub.heartbeat(peer.id)
  hub.deliver(peer.id, event()); await settle()
  expect(sent).toHaveLength(2)
  expect(store.db.prepare('SELECT count(*) AS count FROM audit WHERE action=?').get('push_sent')?.count).toBe(2)
})

it('stays silent for a polling device, a device without opt-in and a development token goes to the sandbox', async () => {
  const { store, device, hub, peer, sent, event, settle } = fixture()
  hub.deliver(peer.id, event()); await settle()
  expect(sent).toEqual([])
  store.registerPush(device, 'cd'.repeat(32), 'development')
  store.events(device, '0')
  hub.deliver(peer.id, event()); await settle()
  expect(sent).toEqual([])
  const { store: second, device: secondDevice, hub: secondHub, peer: secondPeer, sent: secondSent, event: secondEvent, settle: secondSettle } = fixture()
  second.registerPush(secondDevice, 'cd'.repeat(32), 'development')
  secondHub.deliver(secondPeer.id, secondEvent()); await secondSettle()
  expect(secondSent[0]?.host).toBe('api.sandbox.push.apple.com')
})

it('removes stale tokens on 410 or BadDeviceToken, on opt-out and on revocation', async () => {
  const { store, device, hub, peer, sent, event, settle, advance } = fixture(() => ({ status: 410, reason: 'Unregistered' }))
  store.registerPush(device, 'ef'.repeat(32), 'production')
  hub.deliver(peer.id, event()); await settle()
  expect(sent).toHaveLength(1)
  expect(store.pushTarget(device.id)).toBeNull()
  expect(store.db.prepare('SELECT count(*) AS count FROM audit WHERE action=?').get('push_token_unregistered')?.count).toBe(1)
  store.registerPush(device, 'ef'.repeat(32), 'production')
  store.unregisterPush(device.id, 'opt_out')
  expect(store.pushTarget(device.id)).toBeNull()
  store.registerPush(device, 'ef'.repeat(32), 'production')
  store.revoke(device, device.id)
  expect(store.pushTarget(device.id)).toBeNull()
  advance(1)
  expect(() => store.registerPush(device, 'not-hex', 'production')).toThrow('invalid_push_token')
  expect(() => store.registerPush(device, 'ef'.repeat(32), 'staging')).toThrow('invalid_push_environment')
})

it('does nothing while notifications are disabled', async () => {
  const { store, device, event, runtime } = fixture()
  const sent: PushRequest[] = []
  const disabled = new Notifier(store, { enabled: false, keyId: '', teamId: '', key: '', bundle: 'ai.openape.pods', host: 'h', sandboxHost: 's' }, async (request) => { sent.push(request); return { status: 200 } })
  store.registerPush(device, 'ab'.repeat(32), 'production')
  await disabled.afterDelivery(device.id, runtime.id)
  expect(sent).toEqual([])
  expect(event).toBeTypeOf('function')
})
