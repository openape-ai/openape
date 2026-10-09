// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { Owner } from '@openape/pods-protocol'
import { PodDatabase } from '../../src/worker/storage/database'
import { DesktopRegistration } from '../../src/worker/remote/registration'

const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })
function fixture() {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-registration-'))); stores.push(store)
  const registration = new DesktopRegistration(store)
  const owner: Owner = { issuer: 'https://id.example', subject: 'owner@example.test' }
  const current = { id: randomUUID(), generation: randomUUID(), owner }
  registration.execute({ type: 'configure', registration: current })
  return { store, registration, owner, current }
}

it('claims an existing Pod idempotently and follows a renewed registration without changing its identity', () => {
  const { store, registration, owner, current } = fixture()
  const local = store.createPod({ name: 'Existing local Pod' })
  const identity = { subject: 'existing-agent@example.test', keyId: 'existing-key' }
  registration.execute({ type: 'claim', podId: local.id, owner, identity })
  registration.execute({ type: 'claim', podId: local.id, owner, identity })
  expect(store.db.prepare('SELECT count(*) AS count FROM remote_pods').get()?.count).toBe(1)
  expect(() => registration.execute({ type: 'claim', podId: local.id, owner: { ...owner, subject: 'other@example.test' }, identity })).toThrow('wrong_owner')
  expect(() => registration.execute({ type: 'claim', podId: local.id, owner, identity: { ...identity, keyId: 'different' } })).toThrow('pod_identity_conflict')
  const renewed = { ...current, id: randomUUID(), generation: randomUUID() }
  registration.execute({ type: 'configure', registration: renewed })
  expect(registration.execute({ type: 'status' })).toEqual({ registration: renewed, enabled: true })
  const binding = store.db.prepare('SELECT runtime_id,generation,identity FROM remote_pods WHERE pod_id=?').get(local.id)!
  expect(binding).toMatchObject({ runtime_id: renewed.id, generation: renewed.generation })
  expect(JSON.parse(String(binding.identity))).toEqual(identity)
})

it('refuses a registration for another owner without changing the bound one', () => {
  const { registration, owner, current } = fixture()
  expect(() => registration.execute({ type: 'configure', registration: { id: randomUUID(), generation: randomUUID(), owner: { ...owner, subject: 'someone-else' } } })).toThrow('runtime_owner_conflict')
  expect(registration.execute({ type: 'status' })).toEqual({ registration: current, enabled: true })
})

it('prepares local instance identity while registration is disabled', () => {
  const { store, registration, owner } = fixture()
  const pod = store.createPod({ name: 'Local definition instance' })
  registration.execute({ type: 'disable' })
  const identity = { podId: pod.id, subject: 'synthetic-instance@example.test' }
  registration.execute({ type: 'claim', podId: pod.id, owner, identity })
  registration.execute({ type: 'provision', podId: pod.id, identity, error: null })
  expect(registration.execute({ type: 'status' })).toMatchObject({ enabled: false })
  expect(store.db.prepare('SELECT phase FROM remote_pods WHERE pod_id=?').get(pod.id)!.phase).toBe('ready')
  registration.execute({ type: 'provision', podId: pod.id, identity, error: 'Desktop setup required' })
  expect(store.db.prepare('SELECT phase,error FROM remote_pods WHERE pod_id=?').get(pod.id)).toMatchObject({ phase: 'needs_desktop_action', error: 'Desktop setup required' })
  expect(() => registration.execute({ type: 'provision', podId: pod.id, identity: { ...identity, subject: 'replacement' }, error: null })).toThrow('pod_identity_conflict')
})

it('refuses claims before the desktop is registered and provisioning of unclaimed Pods', () => {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-registration-'))); stores.push(store)
  const registration = new DesktopRegistration(store)
  const pod = store.createPod({ name: 'Unclaimed local Pod' })
  const owner: Owner = { issuer: 'https://id.example', subject: 'owner@example.test' }
  expect(registration.execute({ type: 'status' })).toEqual({ registration: null, enabled: false })
  expect(() => registration.execute({ type: 'claim', podId: pod.id, owner, identity: {} })).toThrow('remote_access_disabled')
  registration.execute({ type: 'configure', registration: { id: randomUUID(), generation: randomUUID(), owner } })
  expect(() => registration.execute({ type: 'provision', podId: pod.id, identity: {}, error: null })).toThrow('not_found')
})
