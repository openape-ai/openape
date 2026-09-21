import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { generateKey, publicKey, seal, proofBytes, sha256, signBytes } from '@openape/pods-protocol/crypto'
import type { Owner, Route } from '@openape/pods-protocol'
import { RelayStore } from '../server/utils/store'

const stores: RelayStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function fixture() {
  let now = Date.parse('2026-09-20T12:00:00.000Z')
  const store = new RelayStore(':memory:', () => now); stores.push(store)
  const owner: Owner = { issuer: 'https://id.example', subject: 'owner@example.test' }
  const deviceKey = generateKey(); const runtimeKey = generateKey()
  const device = store.register(randomUUID(), owner, 'mobile', { signing: publicKey(deviceKey), agreement: publicKey(deviceKey) })
  const runtime = store.register(randomUUID(), owner, 'runtime', { signing: publicKey(runtimeKey), agreement: publicKey(runtimeKey) })
  const route: Route = { protocol: 'pods-mobile', major: 1, minor: 0, id: randomUUID(), runtimeId: runtime.id, generation: runtime.generation, deviceId: device.id, keyEpoch: 1, owner, direction: 'command', kind: 'pod.create', kindVersion: 1, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString(), sequence: '0' }
  return { store, owner, device, runtime, deviceKey, runtimeKey, route, advance: (ms: number) => { now += ms }, command: () => seal(route, { name: 'Private' }, runtime.keys.agreement, deviceKey) }
}
it('requires owner, pairing and live runtime before accepting content', () => {
  const { store, device, runtime, command, owner } = fixture()
  expect(() => store.admit(device, command(), () => true)).toThrow('pairing_required')
  store.pair(runtime, device.id)
  expect(() => store.admit(device, command(), () => false)).toThrow('runtime_offline')
  const attacker = store.register(randomUUID(), { ...owner, issuer: 'https://other.example' }, 'mobile', device.keys)
  expect(() => store.pair(runtime, attacker.id)).toThrow('not_found')
  expect(store.list(attacker, 'runtime')).toEqual([])
})
it('deduplicates an exact envelope and rejects changed requests even after delivery', () => {
  const { store, device, runtime, command, route, deviceKey, runtimeKey } = fixture()
  store.pair(runtime, device.id)
  const request = command(); const receipt = store.admit(device, request, () => true)
  expect(store.admit(device, request, () => false)).toEqual(receipt)
  expect(() => store.admit(device, seal(route, { name: 'Different' }, runtime.keys.agreement, deviceKey), () => true)).toThrow('operation_conflict')
  const response = seal({ ...route, direction: 'response', kind: 'receipt', sequence: '1' }, { state: 'completed', secret: 'Local result' }, device.keys.agreement, runtimeKey)
  const cursor = store.deliver(runtime, response)
  expect(store.deliver(runtime, response)).toBe(cursor)
  expect(store.pending(runtime)).toEqual([])
  expect(store.events(device, '0')).toHaveLength(1)
  expect(JSON.stringify(store.db.prepare('SELECT * FROM events').all())).not.toContain('Local result')
  store.acknowledge(device, cursor)
  store.acknowledge(device, cursor)
  expect(store.events(device, cursor)).toEqual([])
  expect(() => store.events(device, '0')).toThrow('resync_required')
  expect(store.admit(device, request, () => true)).toEqual(receipt)
})
it('revokes a refresh family on replay without rolling the revocation back', () => {
  const { store, device, deviceKey } = fixture()
  const first = store.issue(device.id)
  const proof = signBytes(proofBytes('session-refresh', device.id, sha256(first.refreshToken)), deviceKey)
  expect(() => store.refresh(first.refreshToken, signBytes(proofBytes('session-refresh', device.id, sha256(first.refreshToken)), generateKey()))).toThrow('invalid_device_proof')
  const second = store.refresh(first.refreshToken, proof)
  expect(store.authenticate(second.accessToken).id).toBe(device.id)
  expect(() => store.refresh(first.refreshToken, proof)).toThrow('refresh_replay')
  expect(() => store.authenticate(second.accessToken)).toThrow('authentication_required')
})
it('revocation removes access, pairings and buffered content', () => {
  const { store, device, runtime, route, runtimeKey } = fixture()
  store.pair(runtime, device.id)
  const session = store.issue(device.id)
  store.deliver(runtime, seal({ ...route, direction: 'event', kind: 'snapshot' }, {}, device.keys.agreement, runtimeKey))
  store.revoke(device, runtime.id)
  expect(store.events(device, '0')).toEqual([])
  expect(() => store.registration(runtime.id)).toThrow('registration_unavailable')
  store.revoke(device, device.id)
  expect(() => store.authenticate(session.accessToken)).toThrow()
})
it('never rebinds an existing identifier to new owner or keys', () => {
  const { store, device, owner } = fixture()
  expect(() => store.register(device.id, { ...owner, issuer: 'https://other.example' }, 'mobile', device.keys)).toThrow('registration_conflict')
  expect(() => store.register(device.id, owner, 'mobile', { ...device.keys, signing: publicKey(generateKey()) })).toThrow('registration_conflict')
})
it('removes one desktop pairing and buffered content without revoking the mobile identity', () => {
  const { store, device, runtime, route, runtimeKey, command } = fixture()
  const session = store.issue(device.id)
  store.pair(runtime, device.id)
  store.admit(device, command(), () => true)
  store.deliver(runtime, seal({ ...route, id: randomUUID(), direction: 'event', kind: 'snapshot' }, {}, device.keys.agreement, runtimeKey))
  store.unpair(runtime, device.id)
  expect(store.authenticate(session.accessToken)).toEqual(device)
  expect(store.pending(runtime)).toEqual([])
  expect(store.events(device, '0')).toEqual([])
  expect(() => store.requirePair(runtime, device)).toThrow('pairing_required')
})
it('purges short-lived content and requires resync after a replay gap', () => {
  const { store, device, runtime, route, runtimeKey, advance, command } = fixture()
  store.pair(runtime, device.id); store.admit(device, command(), () => true)
  store.deliver(runtime, seal({ ...route, id: randomUUID(), direction: 'event', kind: 'snapshot' }, {}, device.keys.agreement, runtimeKey))
  advance(86400001); store.purge()
  expect(() => store.events(device, '0')).toThrow('resync_required')
  expect(store.operation(device, route.id)).toMatchObject({ state: 'unknown' })
  expect(store.db.prepare('SELECT envelope FROM operations').get()?.envelope).toBeNull()
})
it('rotates the runtime generation: pending commands become unknown, buffered content and pairings are dropped', () => {
  const { store, device, runtime, route, runtimeKey, command } = fixture()
  store.pair(runtime, device.id); store.admit(device, command(), () => true)
  store.deliver(runtime, seal({ ...route, id: randomUUID(), direction: 'event', kind: 'snapshot' }, {}, device.keys.agreement, runtimeKey))
  const rotated = store.rotate(runtime)
  expect(rotated.generation).not.toBe(runtime.generation)
  expect(store.pending(rotated)).toEqual([])
  expect(store.isPaired(rotated, device)).toBe(false)
  expect(() => store.operation(device, route.id)).toThrow('pairing_required')
  store.pair(rotated, device.id)
  expect(store.operation(device, route.id)).toMatchObject({ state: 'unknown', code: 'runtime_rotated_reconcile_desktop' })
  expect(store.events(device, '0')).toEqual([])
  expect(() => store.admit(device, command(), () => true)).toThrow('not_found')
  expect(() => store.rotate(device)).toThrow('wrong_actor')
})
it('revoked identities cannot authenticate, submit, deliver or list', () => {
  const { store, device, runtime, route, runtimeKey, command } = fixture()
  store.pair(runtime, device.id)
  const session = store.issue(device.id); const runtimeSession = store.issue(runtime.id)
  store.revoke(device, device.id)
  expect(() => store.authenticate(session.accessToken)).toThrow('authentication_required')
  expect(() => store.admit(device, command(), () => true)).toThrow('pairing_required')
  expect(() => store.deliver(runtime, seal({ ...route, direction: 'event', kind: 'snapshot' }, {}, device.keys.agreement, runtimeKey))).toThrow('registration_unavailable')
  expect(store.list(runtime, 'mobile')).toEqual([])
  expect(store.authenticate(runtimeSession.accessToken).id).toBe(runtime.id)
})
it('keeps receipts across two database connections and purges them only after the receipt retention', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pods-relay-store-'))
  let now = Date.parse('2026-09-20T12:00:00.000Z'); const clock = () => now
  const first = new RelayStore(join(directory, 'relay.sqlite'), clock); const second = new RelayStore(join(directory, 'relay.sqlite'), clock); stores.push(first, second)
  try {
    const owner: Owner = { issuer: 'https://id.example', subject: 'owner@example.test' }
    const deviceKey = generateKey(); const runtimeKey = generateKey()
    const device = first.register(randomUUID(), owner, 'mobile', { signing: publicKey(deviceKey), agreement: publicKey(deviceKey) })
    const runtime = first.register(randomUUID(), owner, 'runtime', { signing: publicKey(runtimeKey), agreement: publicKey(runtimeKey) })
    const route: Route = { protocol: 'pods-mobile', major: 1, minor: 0, id: randomUUID(), runtimeId: runtime.id, generation: runtime.generation, deviceId: device.id, keyEpoch: 1, owner, direction: 'command', kind: 'pod.create', kindVersion: 1, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString(), sequence: '0' }
    first.pair(runtime, device.id)
    const receipt = first.admit(device, seal(route, { name: 'Private' }, runtime.keys.agreement, deviceKey), () => true)
    expect(second.operation(device, route.id)).toEqual(receipt)
    now += 86400001; second.purge()
    expect(first.operation(device, route.id)).toMatchObject({ state: 'unknown' })
    now += 30 * 86400000; first.purge()
    expect(() => second.operation(device, route.id)).toThrow('not_found')
  }
  finally { rmSync(directory, { recursive: true, force: true }) }
})
it('bounds the replay buffer per runtime so one desktop cannot starve another', () => {
  const { store, device, runtime, route, runtimeKey, owner } = fixture()
  const otherKey = generateKey()
  const other = store.register(randomUUID(), owner, 'runtime', { signing: publicKey(otherKey), agreement: publicKey(otherKey) })
  store.pair(runtime, device.id); store.pair(other, device.id)
  for (let i = 0; i < 1000; i++) store.deliver(runtime, seal({ ...route, id: randomUUID(), direction: 'event', kind: 'snapshot' }, {}, device.keys.agreement, runtimeKey))
  expect(() => store.deliver(runtime, seal({ ...route, id: randomUUID(), direction: 'event', kind: 'snapshot' }, {}, device.keys.agreement, runtimeKey))).toThrow('replay_buffer_full')
  const otherRoute = { ...route, id: randomUUID(), runtimeId: other.id, generation: other.generation, direction: 'event' as const, kind: 'snapshot' as const }
  expect(() => store.deliver(other, seal(otherRoute, {}, device.keys.agreement, otherKey))).not.toThrow()
})
