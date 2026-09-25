import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import Onboarding from '../../src/renderer/Onboarding.vue'
import App from '../../src/renderer/App.vue'
import type { OnboardingView } from '../../src/contracts/onboarding'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { SetupControl } from '../../src/worker/onboarding/control'
import { installWorkspace } from '../layout/workspace-fixture'

// Formerly the packaged `onboarding` E2E (all but its Node case): account
// state, explicit continuation and retained provider consent against real
// SQLite, and the renderer's side of the same flow.
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function profile() { const root = mkdtempSync(join(tmpdir(), 'pods-setup-state-')); roots.push(root); return root }
const setup = (store: PodDatabase) => new SetupControl(store, new ResourceRegistry(store, () => {}))

it('starts incomplete and becomes complete only on the explicit finish, without creating or activating anything', () => {
  const store = new PodDatabase(profile())
  try {
    const control = setup(store)
    expect(control.execute({ type: 'list' })).toMatchObject({ connections: [], complete: false })
    control.execute({ type: 'finish' })
    expect(control.execute({ type: 'list' })).toMatchObject({ connections: [], complete: true })
    expect(store.listPods()).toEqual([])
    expect(store.db.prepare('SELECT count(*) AS count FROM schedules').get()?.count).toBe(0)
  }
  finally { store.close() }
})

it('keeps a confirmed provider consent across a restart without moving existing pods', () => {
  const root = profile(); let store = new PodDatabase(root)
  const pods = [store.createPod({ name: 'New provider pod' }), store.createPod({ name: 'Connected provider pod' })]
  const owner = { id: randomUUID(), provider: 'openape' as const, account: 'owner@example.invalid', state: 'ready' as const, error: null }
  const metadata = { issuer: 'https://id.example.invalid', subject: 'owner@example.invalid', pods: { [pods[1]!.id]: { connectionId: randomUUID(), prepared: false } } }
  setup(store).execute({ type: 'save', connection: owner, metadata })
  expect(setup(store).connections.metadata(owner.id)).not.toHaveProperty('broker')
  setup(store).execute({ type: 'save', connection: owner, metadata: { ...metadata, broker: { issuer: 'https://pods.example.invalid', domain: 'pods.example.invalid', connectionId: randomUUID() } } })
  store.close(); store = new PodDatabase(root)
  try {
    expect(setup(store).connections.metadata(owner.id)).toMatchObject({ broker: { domain: 'pods.example.invalid' } })
    expect(store.listPods()).toEqual(pods)
  }
  finally { store.close() }
})

it('continues to the workspace only after the worker accepted the finish', async () => {
  const view: OnboardingView = { connections: [], owner: null, runtime: { ready: true, error: null }, complete: false }
  const onboarding = vi.fn(async (_command: unknown) => view)
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(Onboarding); await flushPromises()
  onboarding.mockRejectedValueOnce(new Error('Worker unavailable'))
  const proceed = () => wrapper.findAll('button').find(button => button.text() === 'Continue to workspace')!.trigger('click')
  await proceed(); await flushPromises()
  expect(wrapper.emitted('finished')).toBeUndefined()
  await proceed(); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'finish' })
  expect(wrapper.emitted('finished')).toHaveLength(1)
  wrapper.unmount()
})

it('keeps the owner account reachable from the collapsed sidebar', async () => {
  const owner = randomUUID()
  installWorkspace({ onboarding: async () => ({ connections: [{ id: owner, provider: 'openape', account: 'original@example.invalid', state: 'ready', error: null, login: null }], owner, runtime: { ready: true, error: null }, complete: true }) })
  const wrapper = mount(App, { attachTo: document.body }); await flushPromises()
  await wrapper.get('button[aria-label="Collapse sidebar"]').trigger('click')
  await vi.waitFor(() => expect(wrapper.get('.account-avatar').text()).toBe('O'), { timeout: 3000 })
  wrapper.unmount()
})
