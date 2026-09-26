import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import CentralWorkspace from '../../src/renderer/central/CentralWorkspace.vue'
import { WorkspaceRequestError } from '../../src/renderer/central/client'
import { centralFixture } from './central-fixture'
import type { CentralStatus } from '../../src/contracts/central'
import { connected, connectionAfter, connectionLevel } from '../../src/renderer/central/status'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined })
async function open() {
  const fixture = centralFixture()
  wrapper = mount(CentralWorkspace, { props: { client: fixture.client } })
  await flushPromises()
  await wrapper.find('.central-pod').trigger('click'); await flushPromises()
  return fixture
}
it('hides open content when the Pod goes offline and disables opening offline Pods', async () => {
  const fixture = await open()
  expect(wrapper!.text()).toContain('What this Pod does')
  expect(wrapper!.findAll('.central-pod')[1]!.attributes('disabled')).toBeDefined()
  fixture.host.workspace.pods[0]!.online = false; fixture.wake(); await flushPromises()
  expect(wrapper!.text()).toContain('This Pod is offline')
  expect(wrapper!.find('[aria-label="Pod description"]').exists()).toBe(false)
  expect(wrapper!.text()).not.toContain('All checks completed')
})
it('keeps an unsaved draft after a revision conflict and does not retry it', async () => {
  const fixture = await open()
  fixture.client.command = vi.fn(async () => { throw new WorkspaceRequestError(409, 'workspace_revision_conflict') })
  await wrapper!.find('[aria-label="Pod description"]').setValue('My unfinished edit')
  await wrapper!.findAll('button').find(item => item.text() === 'Save description')!.trigger('click'); await flushPromises()
  expect(wrapper!.find('[role="alert"]').text()).toContain('workspace_revision_conflict')
  expect((wrapper!.find('textarea').element as HTMLTextAreaElement).value).toBe('My unfinished edit')
  expect(fixture.client.command).toHaveBeenCalledOnce()
})
it('refreshes untouched editors from another client and preserves local edits', async () => {
  const fixture = await open()
  fixture.view.details.description!.text = 'Saved in the browser'
  fixture.view.details.description!.revision++
  fixture.host.revision++
  fixture.wake(); await flushPromises()
  expect((wrapper!.find('textarea').element as HTMLTextAreaElement).value).toBe('Saved in the browser')
  await wrapper!.find('textarea').setValue('Unfinished desktop edit')
  fixture.view.details.description!.text = 'A newer browser edit'
  fixture.view.details.description!.revision++
  fixture.host.revision++
  fixture.wake(); await flushPromises()
  expect((wrapper!.find('textarea').element as HTMLTextAreaElement).value).toBe('Unfinished desktop edit')
  await wrapper!.findAll('button').find(item => item.text() === 'Reload saved version')!.trigger('click')
  expect((wrapper!.find('textarea').element as HTMLTextAreaElement).value).toBe('A newer browser edit')
})
it('clears a connection failure once the workspace reconnects', async () => {
  const fixture = await open()
  const read = fixture.client.read
  fixture.client.read = async () => { throw new Error('Connection unavailable') }
  fixture.wake(); await flushPromises()
  expect(wrapper!.find('[role="alert"]').text()).toContain('Connection unavailable')
  fixture.client.read = read
  fixture.wake(); await flushPromises()
  expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper!.text()).toContain('What this Pod does')
})
it('retains an operation identity when the request acknowledgement is lost', async () => {
  const fixture = await open()
  fixture.client.command = vi.fn(async () => { throw new TypeError('Connection lost') })
  await wrapper!.findAll('button').find(item => item.text() === 'Save description')!.trigger('click'); await flushPromises()
  expect(wrapper!.text()).toContain('Check pending operation')
  expect(wrapper!.find('fieldset').attributes('disabled')).toBeDefined()
  expect(fixture.client.command).toHaveBeenCalledOnce()
})
it('keeps the open Pod and its online state through a single failed read', async () => {
  const fixture = await open()
  const inventory = fixture.client.inventory
  fixture.client.inventory = async () => { throw new Error('socket hang up') }
  fixture.wake(); await flushPromises()
  expect(wrapper!.find('[role="alert"]').text()).toContain('Reconnecting to your workspace')
  expect(wrapper!.text()).toContain('What this Pod does')
  expect(wrapper!.find('.central-pod small').text()).toContain('Online')
  fixture.wake(); await flushPromises(); fixture.wake(); await flushPromises()
  expect(wrapper!.find('[role="alert"]').text()).toMatch(/Workspace unreachable since .*socket hang up/)
  fixture.client.inventory = inventory
  fixture.wake(); await flushPromises()
  expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
})
it('lists archived Pods in their own labelled section', async () => {
  const fixture = centralFixture()
  fixture.host.workspace.pods[1]!.lifecycle = 'archived'
  wrapper = mount(CentralWorkspace, { props: { client: fixture.client } })
  await flushPromises()
  expect(wrapper.find('details.central-archived summary').text()).toContain('Archived 1')
  expect(wrapper.find('.central-sidebar h3').text()).toBe('Ungrouped 1')
  expect(wrapper.find('.central-sidebar h2').text()).toBe('Pods')
  expect(wrapper.find('details.central-archived').text()).toContain('Monthly report')
  expect(wrapper.findAll('.central-pod').filter(item => item.text().includes('Monthly report'))).toHaveLength(1)
})
it('shows a blocked schedule queue in the sidebar and the Pod overview', async () => {
  const fixture = centralFixture()
  fixture.host.workspace.pods[0]!.queue = { blocked: 1, since: Date.UTC(2026, 8, 25, 9), error: 'Pod execution permission is no longer active' }
  fixture.view.scheduling = { ...fixture.view.scheduling, blocked: 1, blockedSince: Date.UTC(2026, 8, 25, 9), error: 'Pod execution permission is no longer active' }
  wrapper = mount(CentralWorkspace, { props: { client: fixture.client } })
  await flushPromises()
  expect(wrapper.find('.central-pod .central-blocked').text()).toContain('Schedule blocked')
  await wrapper.find('.central-pod').trigger('click'); await flushPromises()
  expect(wrapper.find('[role="alert"]').text()).toMatch(/Schedule blocked since .*Pod execution permission is no longer active/)
})
it('tells the owner why this desktop is offline and that schedules are paused', async () => {
  const fixture = centralFixture()
  const since = Date.now() - 10 * 60000
  const status: CentralStatus = { state: 'offline', error: 'worker snapshot: Worker response timed out; reload state before retrying', since, lastOnlineAt: since, gateUntil: 0, lastTickAt: since, tickingSince: null, tickPhase: null, tickTimeout: null, format: 2, runtimeId: fixture.host.id, lastPublication: null }
  wrapper = mount(CentralWorkspace, { props: { client: fixture.client, desktop: true, desktopStatus: status } })
  await flushPromises()
  expect(wrapper.find('[role="alert"]').text()).toMatch(/offline since .*Scheduled runs are paused.*worker snapshot: Worker response timed out/)
  await wrapper.setProps({ desktopStatus: { ...status, state: 'online', error: null } })
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
})
it('loads run events only when the run history is opened', async () => {
  const fixture = await open()
  const run = vi.spyOn(fixture.client, 'run')
  expect(run).not.toHaveBeenCalled()
  await wrapper!.findAll('button').find(item => item.text() === 'View run')!.trigger('click'); await flushPromises()
  expect(run).toHaveBeenCalledOnce()
  expect(wrapper!.text()).toContain(`Details of ${fixture.view.runs.runs[0]!.id}`)
})
it('counts consecutive failures before calling the workspace unreachable', () => {
  let state = connected
  state = connectionAfter(state, 'timeout', 100)
  expect([connectionLevel(state), state.since]).toEqual(['reconnecting', 100])
  state = connectionAfter(connectionAfter(state, 'timeout', 200), 'timeout', 300)
  expect([connectionLevel(state), state.since]).toEqual(['offline', 100])
  expect(connectionLevel(connectionAfter(state, null, 400))).toBe('online')
})
it('warns when a scheduler step timed out although the desktop is online', async () => {
  const fixture = centralFixture()
  const at = Date.now() - 60000
  const status: CentralStatus = { state: 'online', error: null, since: at, lastOnlineAt: at, gateUntil: at, lastTickAt: at, tickingSince: null, tickPhase: null, tickTimeout: { phase: 'storage inspection', at }, format: 2, runtimeId: fixture.host.id, lastPublication: null }
  wrapper = mount(CentralWorkspace, { props: { client: fixture.client, desktop: true, desktopStatus: status } })
  await flushPromises()
  expect(wrapper.find('[role="alert"]').text()).toMatch(/storage inspection.*did not finish/)
})

it('opens Jev, language, accounts and data through the active desktop settings entry point', async () => {
  const { default: DesktopWorkspace } = await import('../../src/renderer/central/DesktopWorkspace.vue')
  const { installWorkspace } = await import('../layout/workspace-fixture')
  const onboarding = vi.fn(async () => ({ connections: [], complete: true, owner: null, runtime: { ready: true, error: null } }))
  const data = vi.fn(async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }))
  installWorkspace({ onboarding, data, central: async (command) => {
    if (command.type === 'status') return { enabled: false }
    if (command.type === 'inventory') return []
    return { requestError: { status: 400, message: 'No fixture change feed' } }
  } })
  wrapper = mount(DesktopWorkspace); await flushPromises()
  const click = async (text: string) => {
    await wrapper!.findAll('button').find(button => button.text() === text)!.trigger('click')
    await flushPromises()
  }
  await click('Desktop settings')
  expect(wrapper.get('h1').text()).toBe('App settings')
  expect(wrapper.get('.jev-connection label').text()).toBe('TypeSafe AI - Jev - API Key')
  expect(wrapper.get('input[type="password"]').attributes('autocomplete')).toBe('new-password')
  expect(wrapper.find('select[aria-label="Language"]').exists()).toBe(true)
  await wrapper.get('.jev-connection input').setValue('synthetic-key')
  await wrapper.get('.jev-connection form').trigger('submit'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'saveTypesafe', key: 'synthetic-key' })
  expect(wrapper.get<HTMLInputElement>('.jev-connection input').element.value).toBe('')
  await click('Data & backups')
  expect(data).toHaveBeenLastCalledWith({ type: 'status' })
  expect(wrapper.find('[aria-label="Data and backups"]').exists()).toBe(true)
  await click('Your accounts')
  expect(wrapper.find('[aria-label="Your accounts"]').exists()).toBe(true)
  await click('Continue to workspace')
  expect(wrapper.find('.central-desktop-settings').exists()).toBe(false)
  await click('Desktop settings')
  expect(wrapper.find('.jev-connection').exists()).toBe(true)
})
