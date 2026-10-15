// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { SetupControl } from '../../src/worker/onboarding/control'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-setup-')); roots.push(root); const store = new PodDatabase(root); stores.push(store)
  const cancel = vi.fn(); const resources = new ResourceRegistry(store, cancel); const control = new SetupControl(store, resources)
  const pod = store.createPod({ name: 'Mail knowledge' })
  const owner = { id: randomUUID(), provider: 'openape' as const, account: 'owner@example.invalid', state: 'ready' as const, error: null }
  const mail = { id: randomUUID(), provider: 'microsoft' as const, account: 'mail@example.invalid', state: 'ready' as const, error: null }
  control.execute({ type: 'save', connection: owner, metadata: { issuer: 'https://id.example.invalid' } }); control.execute({ type: 'save', connection: mail, metadata: {} })
  const setup = { podId: pod.id, revision: pod.revision, ownerConnection: owner.id, mailConnection: mail.id, account: mail.account, folders: [{ id: 'inbox', name: 'Inbox' }], since: '2026-06-01T00:00:00Z', attachments: false }
  const identity = { connectionId: randomUUID(), podId: pod.id, issuer: 'https://id.example.invalid', owner: owner.account, subject: 'agent@example.invalid', keyId: 'key' }
  return { store, resources, cancel, control, pod, owner, mail, setup, identity }
}
it('persists interrupted sign-in as failed and never completes onboarding implicitly', () => {
  const { control, resources, store, owner } = fixture()
  control.execute({ type: 'save', connection: { ...owner, state: 'connecting' }, metadata: {} })
  const reopened = new SetupControl(store, resources)
  expect(reopened.connections.connections().find(item => item.id === owner.id)?.state).toBe('failed')
  expect(reopened.connections.complete()).toBe(false)
})
it('keeps exactly one account per provider and reports it as the owner', () => {
  const { control, owner } = fixture()
  expect(control.connections.owner()).toBe(owner.id)
  expect(() => control.execute({ type: 'save', connection: { ...owner, id: randomUUID(), account: 'second@example.invalid' }, metadata: {} })).toThrow('Only one account')
  control.execute({ type: 'save', connection: { ...owner, state: 'revoked' }, metadata: {} })
  expect(control.connections.owner()).toBe(owner.id)
})

it('refuses the retired mail setup without changing resource assignments', () => {
  const { control, resources, pod, setup, identity } = fixture()
  const before = resources.list(pod.id)
  expect(() => control.execute({ type: 'assign', setup, identity, grants: { messages: 'old-grant' } } as never)).toThrow('Unsupported setup')
  expect(resources.list(pod.id)).toEqual(before)
})
