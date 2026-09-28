import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import CentralWorkspace from '../../src/renderer/central/CentralWorkspace.vue'
import DesktopWorkspace from '../../src/renderer/central/DesktopWorkspace.vue'
import { installWorkspace, podId } from '../layout/workspace-fixture'
import { WorkspaceRequestError } from '../../src/renderer/central/client'
import { centralFixture } from './central-fixture'
import type { CentralStatus } from '../../src/contracts/central'
import { connected, connectionAfter, connectionLevel } from '../../src/renderer/central/status'
import type { WorkflowCommand, WorkflowView } from '../../src/contracts/workflows'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined })
it('opens local workflows from the desktop landing page and resumes the selected workflow', async () => {
  const id = '00000000-0000-4000-8000-000000000003'
  const view: WorkflowView = { workflows: [{ id, revision: 1, name: 'Morning review', nodes: [{ podId, after: [], handoff: true }], schedule: null, enabled: false, paused: true, nextAt: null }], runs: [] }
  const workflows = vi.fn(async (command: WorkflowCommand) => {
    if (command.type === 'pause') { view.workflows[0]!.paused = command.paused; view.workflows[0]!.revision++ }
    return structuredClone(view)
  })
  installWorkspace({ workflows, central: async command => command.type === 'status' ? { enabled: false } : command.type === 'inventory' ? [] : { requestError: { status: 400, message: 'No fixture change feed' } } })
  wrapper = mount(DesktopWorkspace); await flushPromises()
  const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.text() === text)!.trigger('click'); await flushPromises() }
  expect(workflows).toHaveBeenCalledExactlyOnceWith({ type: 'list' })
  await wrapper.get('.workflow-inventory button').trigger('click'); await flushPromises()
  expect(wrapper.find('.workflow-graph').text()).toContain('Mail knowledge')
  await click('Resume workflow')
  expect(workflows).toHaveBeenLastCalledWith({ type: 'pause', id, revision: 1, paused: false })
  expect(wrapper.text()).toContain('Pause workflow')
  workflows.mockRejectedValueOnce(new Error('Workflow connection unavailable'))
  await click('Pause workflow')
  expect(wrapper.get('[role="alert"]').text()).toContain('Workflow connection unavailable')
})
async function open() {
  const fixture = centralFixture()
  wrapper = mount(CentralWorkspace, { props: { client: fixture.client } })
  await flushPromises()
  await wrapper.find('.central-pod').trigger('click'); await flushPromises()
  return fixture
}
it('hides open content when the Pod goes offline and prevents editing offline Pods', async () => {
  const fixture = await open()
  expect(wrapper!.text()).toContain('What this Pod does')
  expect(wrapper!.find('fieldset').attributes('disabled')).toBeUndefined()
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
  expect(wrapper!.get('.central-content > .text-button').attributes('disabled')).toBeDefined()
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
  expect(wrapper!.find('.central-eyebrow').text()).toContain('ONLINE')
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
  expect(wrapper.get('h1').text()).toBe('Pods')
  expect(wrapper.findAll('.central-pod')).toHaveLength(1)
  await wrapper.findAll('.inventory-toolbar button').find(button => button.text() === 'Archived')!.trigger('click')
  expect(wrapper.findAll('.central-pod')).toHaveLength(1)
  expect(wrapper.find('.central-pod').text()).toContain('Monthly report')
  await wrapper.find('.central-pod').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('This Pod is offline')

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
  const onboarding = vi.fn(async () => ({ connections: [], complete: true, owner: null, runtime: { ready: true, error: null } }))
  const data = vi.fn(async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }))
  installWorkspace({ onboarding, data, central: async (command) => {
    if (command.type === 'status') return { enabled: false }
    if (command.type === 'inventory') return []
    return { requestError: { status: 400, message: 'No fixture change feed' } }
  } })
  wrapper = mount(DesktopWorkspace); await flushPromises()
  await wrapper.get('.workspace-navigation button[aria-label="App settings"]').trigger('click'); await flushPromises()
  expect(wrapper.get('.app-settings h1').text()).toBe('App settings')
  await wrapper.get('.jev-account-row button').trigger('click'); await flushPromises()
  expect(wrapper.get('.jev-connection label').text()).toBe('TypeSafe AI - Jev - API Key')
  expect(wrapper.get('input[type="password"]').attributes('autocomplete')).toBe('new-password')
  expect(wrapper.find('select[aria-label="Language"]').exists()).toBe(true)
  await wrapper.get('.jev-connection input').setValue('synthetic-key')
  await wrapper.get('.jev-connection form').trigger('submit'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'saveTypesafe', key: 'synthetic-key' })
  expect(wrapper.get<HTMLInputElement>('.jev-connection input').element.value).toBe('')
  await wrapper.get('.app-settings details:last-child summary').trigger('click'); await flushPromises()
  expect(data).toHaveBeenLastCalledWith({ type: 'status' })
  expect(wrapper.find('[aria-label="Data and backups"]').exists()).toBe(true)
  expect(wrapper.find('[aria-label="Your accounts"]').exists()).toBe(true)
  await wrapper.get('.workspace-navigation button[aria-label="Pods"]').trigger('click')
  await wrapper.get('.account-status').trigger('click'); await flushPromises()
  expect(wrapper.find('[aria-label="Your accounts"]').exists()).toBe(true)

})

it('archives before deletion, confirms the reviewed Pod and clears deleted content', async () => {
  const fixture = await open()
  const command = vi.spyOn(fixture.client, 'command').mockImplementation(async (_runtime, _revision, command, id) => {
    if (command.channel === 'workspace') {
      fixture.view.scripts.pod.lifecycle = 'archived'; fixture.view.scripts.pod.revision++
    }
    if (command.channel === 'data') fixture.host.workspace.pods = fixture.host.workspace.pods.filter(pod => pod.id !== fixture.view.id)
    return { id, runtimeId: fixture.host.id, command, state: 'applied', result: null, error: null, revision: ++fixture.host.revision }
  })
  const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.text() === text)!.trigger('click'); await flushPromises() }
  await click('Settings')
  expect(wrapper!.text()).not.toContain('Delete Pod…')
  await click('Archive pod')
  expect(command).toHaveBeenLastCalledWith(fixture.host.id, 1, { channel: 'workspace', body: { type: 'update', id: fixture.view.id, revision: 1, name: 'Release monitor', lifecycle: 'archived' } }, expect.any(String))
  await click('Delete Pod…')
  expect(wrapper!.get('[role="alertdialog"]').text()).toContain('Permanently delete Release monitor?')
  await click('Cancel')
  expect(command).toHaveBeenCalledTimes(1)
  expect(wrapper!.find('[role="alertdialog"]').exists()).toBe(false)
  await click('Delete Pod…'); await click('Delete Pod')
  expect(command).toHaveBeenLastCalledWith(fixture.host.id, 2, { channel: 'data', body: { type: 'deletePod', podId: fixture.view.id, revision: 2, name: 'Release monitor' } }, expect.any(String))
  expect(wrapper!.text()).toContain('Pod deleted.')
  expect(wrapper!.text()).not.toContain('Release monitor')
  expect(wrapper!.find('.central-title').exists()).toBe(false)
})

it('shows deletion refusal without removing the Pod or repeating the command', async () => {
  const fixture = await open()
  fixture.view.scripts.pod.lifecycle = 'archived'; fixture.wake(); await flushPromises()
  const command = vi.spyOn(fixture.client, 'command').mockImplementation(async (_runtime, _revision, command, id) => ({ id, runtimeId: fixture.host.id, command, state: 'failed', result: null, error: 'Pod is referenced by workflow configuration or history', revision: fixture.host.revision }))
  const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.text() === text)!.trigger('click'); await flushPromises() }
  await click('Settings'); await click('Delete Pod…'); await click('Delete Pod')
  expect(wrapper!.text()).toContain('Pod is referenced by workflow configuration or history')
  expect(wrapper!.text()).toContain('Release monitor')
  expect(command).toHaveBeenCalledOnce()
})

it('mounts native editors only for this desktop and never sends another runtime Pod to local IPC', async () => {
  const fixture = centralFixture()
  const details = vi.fn(async () => fixture.view.details)
  const localId = '00000000-0000-4000-8000-000000000199'
  installWorkspace({ details, central: async (command) => {
    if (command.type === 'status') return { enabled: true, state: 'online', runtimeId: localId }
    if (command.type === 'inventory') return [fixture.host]
    if (command.type === 'read') return { revision: 1, total: 1, pod: fixture.view }
    return { requestError: { status: 400, message: 'No fixture change feed' } }
  } })
  wrapper = mount(DesktopWorkspace); await flushPromises()
  await wrapper.get('.workspace-navigation button[aria-label="Pods"]').trigger('click'); await flushPromises()
  await wrapper.get('.central-pod').trigger('click'); await flushPromises()
  expect(wrapper.get('.central-title h1').text()).toBe('Release monitor')
  expect(details).not.toHaveBeenCalled()
  expect(wrapper.find('[role="tabpanel"]').exists()).toBe(false)
  fixture.host.workspace.pods[0]!.id = podId
  expect(wrapper.find('.mcp-access').exists()).toBe(false)
})

it('creates a standalone Pod through the central command receipt and opens its saved settings', async () => {
  const fixture = centralFixture()
  const id = '00000000-0000-4000-8000-000000000201'
  const command = vi.spyOn(fixture.client, 'command').mockImplementation(async (_runtime, _revision, command, receiptId) => {
    const created = { ...fixture.host.workspace.pods[0]!, id, name: String(command.body.name) }
    fixture.host.workspace.pods.push(created)
    fixture.view.id = id; fixture.view.scripts.pod = created
    return { id: receiptId, runtimeId: fixture.host.id, command, state: 'applied', result: null, error: null, revision: ++fixture.host.revision }
  })
  wrapper = mount(CentralWorkspace, { props: { client: fixture.client } }); await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === '＋ New pod')!.trigger('click')
  await wrapper.get('[aria-label="New Pod name"]').setValue('Independent audit')
  await wrapper.get('form.central-create').trigger('submit'); await flushPromises()
  expect(command).toHaveBeenCalledExactlyOnceWith(fixture.host.id, 1, { channel: 'workspace', body: { type: 'create', name: 'Independent audit' } }, expect.any(String))
  expect(wrapper.get('.central-title h1').text()).toBe('Independent audit')
  await wrapper.findAll('.central-tabs button').find(button => button.text() === 'Settings')!.trigger('click')
  expect(wrapper.get('input[maxlength="100"]').element).toHaveProperty('value', 'Independent audit')
})

it('keeps remote edits until navigation is explicitly confirmed', async () => {
  await open()
  await wrapper!.get('[aria-label="Pod description"]').setValue('Unfinished remote edit')
  await wrapper!.get('.central-content > .text-button').trigger('click')
  expect(wrapper!.get('[aria-label="Unsaved changes"]').text()).toContain('Keep editing')
  await wrapper!.findAll('button').find(button => button.text() === 'Keep editing')!.trigger('click')
  expect((wrapper!.get('[aria-label="Pod description"]').element as HTMLTextAreaElement).value).toBe('Unfinished remote edit')
  await wrapper!.get('.central-content > .text-button').trigger('click')
  await wrapper!.findAll('button').find(button => button.text() === 'Discard changes')!.trigger('click')
  expect(wrapper!.find('.central-inventory').exists()).toBe(true)
  await wrapper!.get('.central-pod').trigger('click'); await flushPromises()
  expect((wrapper!.get('[aria-label="Pod description"]').element as HTMLTextAreaElement).value).not.toBe('Unfinished remote edit')
})
