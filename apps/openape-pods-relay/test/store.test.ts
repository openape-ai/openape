import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { generateKey, proofBytes, publicKey, sha256, signBytes } from '@openape/pods-protocol/crypto'
import type { Owner } from '@openape/pods-protocol'
import { RelayStore } from '../server/utils/store'

const stores: RelayStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
const start = Date.parse('2026-09-20T12:00:00.000Z')
function fixture() {
  let now = start
  const store = new RelayStore(':memory:', () => now); stores.push(store)
  const owner: Owner = { issuer: 'https://id.example', subject: 'owner@example.test' }
  const runtimeKey = generateKey()
  const runtime = store.register(randomUUID(), owner, { signing: publicKey(runtimeKey), agreement: publicKey(runtimeKey) })
  const refreshProof = (token: string, key = runtimeKey) => signBytes(proofBytes('session-refresh', runtime.id, sha256(token)), key)
  return { store, owner, runtime, runtimeKey, refreshProof, advance: (ms: number) => { now += ms } }
}

it('revokes a refresh family on replay without rolling the revocation back', () => {
  const { store, runtime, refreshProof } = fixture()
  const first = store.issue(runtime.id)
  expect(() => store.refresh(first.refreshToken, refreshProof(first.refreshToken, generateKey()))).toThrow('invalid_device_proof')
  const second = store.refresh(first.refreshToken, refreshProof(first.refreshToken))
  expect(store.authenticate(second.accessToken).id).toBe(runtime.id)
  expect(() => store.refresh(first.refreshToken, refreshProof(first.refreshToken))).toThrow('refresh_replay')
  expect(() => store.authenticate(second.accessToken)).toThrow('authentication_required')
})

it('never rebinds an existing identifier to new owner or keys', () => {
  const { store, runtime, owner } = fixture()
  expect(() => store.register(runtime.id, { ...owner, issuer: 'https://other.example' }, runtime.keys)).toThrow('registration_conflict')
  expect(() => store.register(runtime.id, owner, { ...runtime.keys, signing: publicKey(generateKey()) })).toThrow('registration_conflict')
})

it('issues a fresh session for the same runtime after replay', () => {
  const { store, owner, runtime, refreshProof } = fixture()
  const first = store.issue(runtime.id)
  const rotated = store.refresh(first.refreshToken, refreshProof(first.refreshToken))
  expect(() => store.refresh(first.refreshToken, refreshProof(first.refreshToken))).toThrow('refresh_replay')
  const registered = store.register(runtime.id, owner, runtime.keys)
  expect(registered).toEqual(runtime)
  const recovered = store.issue(registered.id)
  expect(store.authenticate(recovered.accessToken)).toEqual(runtime)
  expect(() => store.authenticate(rotated.accessToken)).toThrow('authentication_required')
})

it('refuses replayed, foreign, mismatched and stale request proofs', () => {
  const { store, runtime, runtimeKey, advance } = fixture()
  const { accessToken } = store.issue(runtime.id)
  const path = '/api/runtime/v1/registration'
  const proof = (key = runtimeKey) => {
    const id = randomUUID(); const at = new Date(start).toISOString(); const digest = sha256('')
    return { id, at, digest, signature: signBytes(proofBytes('api-request', id, JSON.stringify(['GET', path, sha256(accessToken), at, digest])), key) }
  }
  const valid = proof()
  expect(store.authenticateRequest(accessToken, 'GET', path, valid).id).toBe(runtime.id)
  expect(() => store.authenticateRequest(accessToken, 'GET', path, valid)).toThrow('request_replay')
  expect(() => store.authenticateRequest(accessToken, 'GET', path, proof(generateKey()))).toThrow('invalid_request_proof')
  expect(() => store.authenticateRequest(accessToken, 'POST', path, proof())).toThrow('invalid_request_proof')
  advance(31000)
  expect(() => store.authenticateRequest(accessToken, 'GET', path, proof())).toThrow('invalid_request_proof')
})

it('refuses sessions of retained identities that are not desktop runtimes', () => {
  const { store, owner, runtime } = fixture()
  const other = randomUUID()
  store.db.prepare('INSERT INTO registrations VALUES(?,?,?,?,?,1,0)').run(other, JSON.stringify(owner), 'mobile', JSON.stringify(runtime.keys), randomUUID())
  const session = store.issue(other)
  expect(() => store.authenticate(session.accessToken)).toThrow('wrong_actor')
  expect(() => store.register(other, owner, runtime.keys)).toThrow('registration_conflict')
})

it('purges expired sessions, request proofs and login flows', () => {
  const { store, runtime, advance } = fixture()
  const session = store.issue(runtime.id)
  store.db.prepare('INSERT INTO request_proofs VALUES(?,?)').run(randomUUID(), start + 60000)
  store.db.prepare('INSERT INTO auth_flows VALUES(?,NULL,?,?,NULL)').run(randomUUID(), '{}', start + 300000)
  advance(7 * 86400000 + 1); store.purge()
  expect(() => store.authenticate(session.accessToken)).toThrow('authentication_required')
  for (const table of ['sessions', 'request_proofs', 'auth_flows']) expect(store.db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count).toBe(0)
})
