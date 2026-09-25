import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { generateKey, publicKey } from '@openape/pods-protocol/crypto'
import { capabilities } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { RelayStore } from '../server/utils/store'
import { RuntimeHub } from '../server/utils/hub'

const stores: RelayStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function peer(id: string) {
  const sent: string[] = []; const closed: [number, string][] = []
  return { id, sent, closed, send: (data: string) => { sent.push(data) }, close: (code: number, reason: string) => { closed.push([code, reason]) } }
}
it('keeps one live socket per runtime identity and refuses frames from the replaced socket', () => {
  let now = Date.parse('2026-09-21T12:00:00.000Z')
  const store = new RelayStore(':memory:', () => now); stores.push(store)
  const owner: Owner = { issuer: 'https://id.example', subject: 'owner@example.test' }
  const key = generateKey()
  const runtime = store.register(randomUUID(), owner, 'runtime', { signing: publicKey(key), agreement: publicKey(key) })
  const token = store.issue(runtime.id).accessToken
  const hub = new RuntimeHub(store)
  const first = peer('first'); const second = peer('second')
  hub.connect(first, token, capabilities)
  expect(hub.online(runtime.id)).toBe(true)
  hub.connect(second, token, capabilities)
  expect(first.closed).toEqual([[1008, 'Runtime connection replaced or revoked']])
  expect(() => hub.heartbeat(first.id)).toThrow('runtime_session_expired')
  expect(() => hub.deliver(first.id, {})).toThrow('runtime_session_expired')
  hub.heartbeat(second.id)
  expect(second.sent.filter(frame => JSON.parse(frame).type === 'heartbeat')).toHaveLength(1)
  now += 46000
  expect(hub.online(runtime.id)).toBe(false)
  hub.tick()
  expect(second.closed).toEqual([[1008, 'Runtime connection replaced or revoked']])
  store.revoke(runtime, runtime.id)
  expect(() => hub.connect(peer('third'), token, capabilities)).toThrow('authentication_required')
})
