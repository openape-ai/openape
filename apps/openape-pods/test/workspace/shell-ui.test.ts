import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/renderer/App.vue'
import type { WorkspaceState } from '../../src/contracts/control'
import type { RunCommand } from '../../src/contracts/runs'
import { installWorkspace, podId, pods } from '../layout/workspace-fixture'

// Behaviour formerly asserted by the packaged `pod-workspace`, `groups` and
// `foundation` E2E files; geometry for the same views lives in test/layout.
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.unstubAllGlobals() })
async function mountApp() {
  wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
  return wrapper
}
const tab = (name: string) => wrapper!.findAll('[role="tab"]').find(item => item.text() === name)!
const button = (name: string) => wrapper!.findAll('button').find(item => item.text().trim() === name)!

describe('workspace shell', () => {
  it('moves between tabs with the arrow keys and keeps only the selected tab in the tab order', async () => {
    installWorkspace()
    await mountApp()
    expect(tab('Overview').attributes('tabindex')).toBe('0')
    await tab('Overview').trigger('keydown', { key: 'ArrowRight' }); await flushPromises()
    expect(tab('Script').attributes('aria-selected')).toBe('true')
    expect(tab('Script').attributes('tabindex')).toBe('0')
    expect(tab('Overview').attributes('tabindex')).toBe('-1')
    await tab('Script').trigger('keydown', { key: 'ArrowLeft' }); await flushPromises()
    expect(tab('Overview').attributes('aria-selected')).toBe('true')
  })

  it('disables Run now for an archived pod even though it still has an active script', async () => {
    const runs = vi.fn(async (_command: RunCommand) => ({ runs: [], events: [] }))
    installWorkspace({ runs })
    await mountApp()
    expect(button('Run now').attributes('disabled')).toBeUndefined()
    await wrapper!.findAll('.pod-button').find(item => item.text().includes('Archived research'))!.trigger('click'); await flushPromises()
    expect(wrapper!.get('h1').text()).toBe('Archived research')
    expect(button('Run now').attributes('disabled')).toBeDefined()
    expect(runs.mock.calls.some(([command]) => command.type === 'start')).toBe(false)
  })

  it('opens Codex connection settings from knowledge', async () => {
    installWorkspace()
    await mountApp()
    await button('Results and sources').trigger('click'); await flushPromises()
    await button('Work from Codex').trigger('click'); await flushPromises()
    expect(wrapper!.get('h1').text()).toBe('App settings')
    expect(wrapper!.text()).toContain('Connected Codex can administer')
    expect(wrapper!.get('.jev-connection label').text()).toBe('TypeSafe AI - Jev - API Key')
  })

  it('lists assigned directories and references in Permissions but never account connections', async () => {
    installWorkspace()
    await mountApp()
    await tab('Permissions').trigger('click'); await flushPromises()
    const panel = wrapper!.get('[role="tabpanel"]').text()
    expect(panel).toContain('Orders')
    expect(panel).toContain('Reference')
    expect(panel).not.toContain('Microsoft fixture')
    expect(panel).not.toContain('Jev')
    await tab('Script').trigger('click'); await flushPromises()
    expect(wrapper!.text()).not.toContain('Jev script reference')
  })
})

describe('pod groups', () => {
  const groupId = '00000000-0000-4000-8000-0000000000a1'
  const organized = (): WorkspaceState => ({ organization: { revision: 3, groups: [{ id: groupId, name: 'Work', collapsed: false, podIds: [] }] }, pods: structuredClone(pods) })

  it('moves a dragged pod into the group it is dropped on', async () => {
    const workspace = vi.fn(async () => organized())
    installWorkspace({ workspace })
    await mountApp()
    const pod = wrapper!.findAll('.pod-button').find(item => item.text().includes('Mail knowledge'))!
    await pod.trigger('dragstart', { dataTransfer: { setData: () => {}, effectAllowed: '' } })
    await wrapper!.get('[aria-label="Work group"]').trigger('drop'); await flushPromises()
    expect(workspace).toHaveBeenCalledWith({ type: 'organize', revision: 3, action: 'move', podId, groupId })
  })

  it('assigns the selected pod to a group from Settings', async () => {
    const workspace = vi.fn(async () => organized())
    installWorkspace({ workspace })
    await mountApp()
    await tab('Settings').trigger('click'); await flushPromises()
    const select = wrapper!.findAll('select').find(item => item.findAll('option').some(option => option.text() === 'Work'))!
    await select.setValue(groupId); await flushPromises()
    expect(workspace).toHaveBeenCalledWith({ type: 'organize', revision: 3, action: 'move', podId, groupId })
  })
})

describe('schedule limits', () => {
  it('saves the global concurrency limit as an explicit owner command', async () => {
    const scheduling = vi.fn(async () => ({ spec: null, enabled: false, revision: 1, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }))
    installWorkspace({ scheduling })
    await mountApp()
    await tab('Settings').trigger('click'); await flushPromises()
    const input = wrapper!.findAll('label').find(item => item.text().includes('Concurrent pods on this Mac'))!.get('input')
    await input.setValue(3)
    await wrapper!.get('.limit-form').trigger('submit'); await flushPromises()
    expect(scheduling).toHaveBeenCalledWith({ type: 'concurrency', podId, maximum: 3 })
  })
})
