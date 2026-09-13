// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { SetupControl } from '../../src/worker/onboarding/control'
import { assertMailHistory } from '../../src/worker/mail/authorization'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-setup-')); roots.push(root); const store = new PodDatabase(root); stores.push(store)
  const cancel = vi.fn(); const resources = new ResourceRegistry(store, cancel); const control = new SetupControl(store, resources)
  const pod = store.createPod({ name: 'Mail knowledge', assignment: 'Read synthetic mail only' })
  const owner = { id: randomUUID(), provider: 'openape' as const, account: 'owner@example.invalid', state: 'ready' as const, error: null }
  const mail = { id: randomUUID(), provider: 'microsoft' as const, account: 'mail@example.invalid', state: 'ready' as const, error: null }
  control.execute({ type: 'save', connection: owner, metadata: { issuer: 'https://id.example.invalid' } }); control.execute({ type: 'save', connection: mail, metadata: {} })
  const setup = { podId: pod.id, revision: pod.revision, ownerConnection: owner.id, mailConnection: mail.id, account: mail.account, folders: [{ id: 'inbox', name: 'Inbox' }], since: '2026-06-01T00:00:00Z', attachments: false }
  const identity = { connectionId: randomUUID(), podId: pod.id, issuer: 'https://id.example.invalid', owner: owner.account, subject: 'agent@example.invalid', keyId: 'key' }
  return { store, resources, cancel, control, pod, owner, mail, setup, identity }
}
it('atomically replaces mail scope, increments its epoch and pauses affected work', () => {
  const { control, resources, pod, setup, identity, cancel, store } = fixture()
  control.execute({ type: 'assign', setup, identity, grants: { messages: 'g1' } })
  expect(resources.list(pod.id).filter(item => item.state === 'ready')).toHaveLength(3)
  control.execute({ type: 'assign', setup: { ...setup, folders: [{ id: 'rules', name: 'Orders' }] }, identity, grants: { messages: 'g2' } })
  expect(resources.epoch(pod.id)).toBe(2); expect(cancel).toHaveBeenCalledTimes(2)
  expect(resources.list(pod.id).filter(item => item.state === 'ready').find(item => item.kind === 'tool')?.configuration.folders).toEqual(['rules'])
  expect(store.getPod(pod.id).lifecycle).toBe('paused')
  expect(store.db.prepare('SELECT * FROM schedules').all()).toHaveLength(0)
})
it('rejects stale permission review and revokes every pod using a disconnected connection', () => {
  const { control, resources, pod, setup, identity, mail, store } = fixture()
  expect(() => control.execute({ type: 'assign', setup: { ...setup, revision: 2 }, identity, grants: {} })).toThrow('changed')
  expect(resources.list(pod.id)).toHaveLength(0)
  control.execute({ type: 'assign', setup, identity, grants: { messages: 'g1' } })
  control.execute({ type: 'revoke', id: mail.id })
  expect(resources.list(pod.id).filter(item => item.configuration.connectionId === mail.id).every(item => item.state === 'revoked')).toBe(true)
  expect(store.listPods()).toHaveLength(1)
})
it('persists interrupted sign-in as failed and never completes onboarding implicitly', () => {
  const { control, resources, store, owner } = fixture()
  control.execute({ type: 'save', connection: { ...owner, state: 'connecting' }, metadata: {} })
  const reopened = new SetupControl(store, resources)
  expect(reopened.connections.connections().find(item => item.id === owner.id)?.state).toBe('failed')
  expect(reopened.connections.complete()).toBe(false)
})
it('denies attachment parents outside the received-date scope, including unknown dates and foreign folders', () => {
  const { store, pod, mail } = fixture()
  for (const [id, receivedAt] of [['old', '2026-05-31T23:59:59Z'], ['new', '2026-06-01T00:00:00Z'], ['unknown', 'not-a-date']]) store.db.prepare('INSERT INTO mail_items VALUES(?,?,?,?,?,?,?)').run(pod.id, mail.account, id, 'inbox', `source-${id}`, 'matter', JSON.stringify({ receivedAt }))
  const scope = { account: mail.account, folders: ['inbox'], attachments: true, since: '2026-06-01T00:00:00Z' }
  for (const message of ['old', 'unknown', 'missing']) expect(() => assertMailHistory(store, pod.id, scope, { operation: 'attachments', folder: 'inbox', message })).toThrow('parent')
  expect(() => assertMailHistory(store, pod.id, scope, { operation: 'attachment', folder: 'foreign', message: 'new', attachment: 'a1' })).toThrow('parent')
  expect(() => assertMailHistory(store, pod.id, scope, { operation: 'attachments', folder: 'inbox', message: 'new' })).not.toThrow()
})
