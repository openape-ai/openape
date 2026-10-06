import BrowserWorkspace from '../../src/renderer/central/BrowserWorkspace.vue'
import { browserFixture } from './browser-fixture'
import { operationalFixture, recoveryFixture } from '../layout/network-fixture'
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
import { sequenceParts } from '../../src/contracts/workflows'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers() })
it('opens local workflows from the desktop landing page and resumes the selected workflow', async () => {
  const id = '00000000-0000-4000-8000-000000000003'
  const view: WorkflowView = { workflows: [{ ...sequenceParts, id, revision: 1, name: 'Morning review', nodes: [{ podId, after: [], handoff: true }], schedule: null, enabled: false, paused: true, nextAt: null }], runs: [] }
  const workflows = vi.fn(async (command: WorkflowCommand) => {
    if (command.type === 'pause') { view.workflows[0]!.paused = command.paused; view.workflows[0]!.revision++ }
    return structuredClone(view)
  })
  installWorkspace({ workflows, central: async command => command.type === 'status' ? { enabled: false } : command.type === 'inventory' ? [] : { requestError: { status: 400, message: 'No fixture change feed' } } })
  wrapper = mount(DesktopWorkspace); await flushPromises()
  const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.text() === text)!.trigger('click'); await flushPromises() }
  expect(workflows).toHaveBeenCalledExactlyOnceWith({ type: 'list' })
  await wrapper.get('.graph-card').trigger('click'); await flushPromises()
  expect(wrapper.find('.workflow-graph').text()).toContain('Mail knowledge')
  await click('Resume workflow')
  expect(workflows).toHaveBeenCalledWith({ type: 'pause', id, revision: 1, paused: false })
  expect(wrapper.text()).toContain('Pause workflow')
  workflows.mockRejectedValueOnce(new Error('Workflow connection unavailable'))
  await click('Pause workflow')
  expect(wrapper.get('[role="alert"]').text()).toContain('Workflow connection unavailable')
})
it('tells on the desktop overview what a workflow is for', async () => {
  const id = '00000000-0000-4000-8000-000000000003'
  const view: WorkflowView = { workflows: [{ ...sequenceParts, id, revision: 1, name: 'Morning review', nodes: [{ podId, after: [], handoff: true }], schedule: null, enabled: false, paused: true, nextAt: null }], runs: [] }
  const bridge = installWorkspace({ workflows: async () => structuredClone(view), central: async command => command.type === 'status' ? { enabled: false } : command.type === 'inventory' ? [] : { requestError: { status: 400, message: 'No fixture change feed' } } })
  const list = bridge.workspace
  bridge.workspace = async command => ({ ...await list(command), descriptions: [{ id, text: 'Collects calendar, mail and open issues every morning.', revision: 1 }] })
  wrapper = mount(DesktopWorkspace); await flushPromises()
  expect(wrapper.get('.graph-card').text()).toContain('Collects calendar, mail and open issues every morning.')
})
it('shows a workflow description read-only in the browser workspace', async () => {
  const f = await browserFixture()
  const id = '00000000-0000-4000-8000-000000000004'
  f.host.workflows = { workflows: [{ ...sequenceParts, id, revision: 1, name: 'Morning review', nodes: [{ podId, after: [], handoff: false }], schedule: null, enabled: false, paused: false, nextAt: null }], runs: [], graphs: true } as never
  f.host.workspace.descriptions = [{ id, text: 'Collects calendar, mail and open issues every morning.', revision: 1 }]
  Reflect.deleteProperty(window, 'pods')
  wrapper = mount(BrowserWorkspace, { props: { client: f.client } }); await flushPromises()
  const card = wrapper.findAll('.graph-card').find(item => item.text().includes('Morning review'))!
  expect(card.text()).toContain('Collects calendar, mail and open issues every morning.')
  await card.trigger('click'); await flushPromises()
  expect(wrapper.get('.collection-description').text()).toBe('Collects calendar, mail and open issues every morning.')
})
async function open() {
  const fixture = centralFixture()
  wrapper = mount(CentralWorkspace, { props: { client: fixture.client } })
  await flushPromises()
  await wrapper.find('.central-pod').trigger('click'); await flushPromises()
  return fixture
}
it('shows what each Pod does in the inventory before it is opened', async () => {
  const fixture = centralFixture()
  fixture.host.workspace.pods[0]!.description = 'Reviews recent releases.'
  wrapper = mount(CentralWorkspace, { props: { client: fixture.client } }); await flushPromises()
  const rows = wrapper.findAll('.central-pod').map(row => row.text())
  expect(rows[0]).toContain('Reviews recent releases.')
  expect(rows[1]).not.toContain('Reviews recent releases.')
})
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

it('shows the automatic retry time instead of a blocked queue for a temporary service outage', async () => {
  const fixture = centralFixture()
  fixture.view.scheduling.retry = { at: Date.UTC(2026, 8, 29, 8), attempt: 2, error: 'Permission service temporarily unavailable' }
  wrapper = mount(CentralWorkspace, { props: { client: fixture.client } })
  await flushPromises(); await wrapper.find('.central-pod').trigger('click'); await flushPromises()
  await wrapper.findAll('.central-tabs button').find(button => button.text() === 'Settings')!.trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('Waiting for service recovery. Next attempt:')
  expect(wrapper.find('.central-blocked').exists()).toBe(false)
})

it('reads persistent network traces and data in the browser without a desktop bridge or owner actions', async () => {
  const f = await browserFixture(); const network = operationalFixture()
  f.host.networks = { networks: network.view.networks }
  f.host.workspace.pods = network.pods.map(pod => ({ ...pod, online: true }))
  f.host.workspace.organization = network.organization
  network.view.details!.collections = [{ id: network.id(70), name: 'Reviewed cases', version: 1 }]
  const read = vi.fn(async (_runtime, command) => ({ ...network.view, ...(command.type === 'records' ? { records: { collectionId: network.id(70), records: [{ key: 'case-one', revision: 1, schemaVersion: 1, body: '{"status":"reviewed"}', truncated: false, deleted: false, at: 1 }], after: null } } : {}) }))
  f.client.network = read
  f.client.command = vi.fn(f.client.command)
  Reflect.deleteProperty(window, 'pods')
  wrapper = mount(BrowserWorkspace, { props: { client: f.client } }); await flushPromises()
  const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.text().includes(text))!.trigger('click'); await flushPromises() }
  await click(network.definition.name)
  expect(wrapper.text()).toContain('Independent timer')
  await click('Recent recorded activity')
  expect(wrapper.text()).toContain('Item accepted')
  await click('Shared data'); await click('Reviewed cases')
  expect(wrapper.text()).toContain('case-one')
  expect(read).toHaveBeenCalledWith(f.host.id, expect.objectContaining({ type: 'records', collectionId: network.id(70) }))
  for (const label of ['Activate network', 'Pause network', 'Process now', 'Create network']) expect(wrapper.findAll('button').map(button => button.text())).not.toContain(label)
  expect(f.client.command).not.toHaveBeenCalled()
  f.host.online = false; f.wake(); await flushPromises()
  await click('Reviewed cases')
  expect(wrapper.text()).toContain('Desktop offline: network details require the connected runtime')
})

it('retains the network inventory and scoped decisions across browser summary refreshes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const f = await browserFixture(); const network = recoveryFixture()
  const second = { ...network.view.networks[0]!, id: network.id(90), name: 'Second independent network', podIds: [] }
  f.host.networks = { networks: [{ ...network.view.networks[0]!, decisions: 2 }, second] }
  f.host.workspace.pods = network.pods.map(pod => ({ ...pod, online: true }))
  f.host.workspace.organization = network.organization
  f.client.network = vi.fn(async (_runtime, command) => command.type === 'detail'
    ? { networks: network.view.networks, details: network.view.details, gates: network.view.gates }
    : { networks: network.view.networks, trace: network.view.trace })
  Reflect.deleteProperty(window, 'pods')
  wrapper = mount(BrowserWorkspace, { props: { client: f.client } }); await flushPromises()
  const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.text().includes(text))!.trigger('click'); await flushPromises() }
  expect(wrapper.text()).toContain('Second independent network')
  await click(network.definition.name); await click('Decisions and failures')
  expect(wrapper.text()).toContain('Synthetic pending invoice')
  f.wake(); await flushPromises()
  vi.mocked(f.client.network!).mockRejectedValueOnce(new Error('Synthetic transient detail outage'))
  await vi.advanceTimersByTimeAsync(5000); await flushPromises()
  expect(wrapper.text()).toContain('Synthetic pending invoice')
  await click('Networks & workflows')
  expect(wrapper.text()).toContain('Second independent network')
  expect(wrapper.text()).toContain('Decisions: 2')
})

it('shows a network member summary instead of mounting the legacy browser editor', async () => {
  const f = await browserFixture()
  f.view.networkId = '00000000-0000-4000-8000-000000000021'
  wrapper = mount(CentralWorkspace, { props: { client: f.client, sharedEditor: true } }); await flushPromises()
  await wrapper.get('.central-pod').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('review changes on the desktop')
  expect(wrapper.find('.remote-editor').exists()).toBe(false)
  expect(wrapper.find('textarea').exists()).toBe(false)
})

it('recovers the browser activity after the initial network detail request fails', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const f = await browserFixture(); const network = operationalFixture()
  f.host.networks = { networks: [{ ...network.view.networks[0]!, decisions: 2 }] }
  f.client.network = vi.fn(async (_runtime, command) => command.type === 'detail' ? { networks: network.view.networks, details: network.view.details } : { networks: network.view.networks, trace: network.view.trace })
  // The inventory's inbox read and the network detail both hit the outage once.
  vi.mocked(f.client.network).mockRejectedValueOnce(new Error('Synthetic initial network outage')).mockRejectedValueOnce(new Error('Synthetic initial network outage'))
  Reflect.deleteProperty(window, 'pods')
  wrapper = mount(BrowserWorkspace, { props: { client: f.client } }); await flushPromises()
  const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.text() === text)!.trigger('click'); await flushPromises() }
  await wrapper.findAll('button').find(button => button.text().includes(network.definition.name))!.trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('Decisions: 2')
  expect(wrapper.text()).toContain('Synthetic initial network outage')
  await vi.advanceTimersByTimeAsync(5000); await flushPromises()
  await click('Recent recorded activity')
  expect(wrapper.text()).toContain('Item accepted')
  expect(f.client.network).toHaveBeenCalledWith(f.host.id, expect.objectContaining({ type: 'trace' }))
})

it('shows the selected runtime status instead of another online runtime status', async () => {
  const f = await browserFixture()
  const offline = { ...structuredClone(f.host), id: '00000000-0000-4000-8000-000000000088', online: false }
  f.client.inventory = async () => structuredClone([f.host, offline])
  wrapper = mount(BrowserWorkspace, { props: { client: f.client } }); await flushPromises()
  expect(wrapper.get('.runtime-picker select').element).toHaveProperty('value', f.host.id)
  await wrapper.get('.runtime-picker select').setValue(offline.id); await flushPromises()
  expect(wrapper.findAll('[role=status]').map(item => item.text())).toContain('Desktop offline')
  expect(wrapper.text()).toContain('Showing the last synchronized networks and workflows.')
})
