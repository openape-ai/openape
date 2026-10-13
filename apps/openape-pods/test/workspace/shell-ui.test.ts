import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/renderer/App.vue'
import type { RunCommand } from '../../src/contracts/runs'
import { installWorkspace, podId } from '../layout/workspace-fixture'

// Behaviour formerly asserted by the packaged `pod-workspace`, `groups` and
// `foundation` E2E files; geometry for the same views lives in test/layout.
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.unstubAllGlobals() })
async function mountApp() {
  wrapper = mount(App, { attachTo: document.body, props: { initialPodId: '00000000-0000-4000-8000-000000000001' } })
  await flushPromises()
  return wrapper
}
const button = (name: string) => wrapper!.findAll('button').find(item => item.text().trim() === name)!

describe('workspace shell', () => {
  it('shows every Pod section on one page with jump links instead of tabs', async () => {
    installWorkspace()
    await mountApp()
    expect(wrapper!.findAll('[role="tab"]')).toHaveLength(0)
    expect(wrapper!.findAll('.section-links button').map(item => item.text())).toEqual(['Runs', 'Variables and secrets', 'Access', 'Settings', 'Code'])
    for (const id of ['overview', 'runs', 'values', 'access', 'settings', 'code']) expect(wrapper!.find(`#section-${id}`).exists()).toBe(true)
    // The script editor loads only when the Code section is opened.
    expect(wrapper!.find('#section-code .code-editor').exists()).toBe(false)
  })

  it('disables Run now for an archived pod even though it still has an active script', async () => {
    const runs = vi.fn(async (_command: RunCommand) => ({ runs: [], events: [] }))
    installWorkspace({ runs })
    wrapper = mount(App, { attachTo: document.body, props: { initialPodId: '00000000-0000-4000-8000-000000000002' } }); await flushPromises()
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
    expect(wrapper!.text()).toContain('Connecting Codex grants no access: each Codex session asks for your DDISA sign-in.')
    await wrapper!.get('.jev-account-row button').trigger('click'); await flushPromises()
    expect(wrapper!.get('.jev-connection label').text()).toBe('TypeSafe AI - Jev - API Key')
  })

  it('lists assigned directories and references in Permissions but never account connections', async () => {
    installWorkspace()
    await mountApp()
    const panel = wrapper!.get('#section-access').text()
    expect(panel).toContain('Orders')
    expect(panel).toContain('Reference')
    expect(panel).not.toContain('Microsoft fixture')
    expect(panel).not.toContain('Jev')
    await button('Code').trigger('click'); await flushPromises()
    expect(wrapper!.text()).not.toContain('Jev script reference')
  })
})

describe('pod settings', () => {
  it('offers no group selector, because tags classify Pods (issue 1468)', async () => {
    installWorkspace()
    await mountApp()
    expect(wrapper!.find('#section-settings').exists()).toBe(true)
    expect(wrapper!.find('#pod-group').exists()).toBe(false)
    expect(wrapper!.text()).not.toContain('New group')
  })
})

describe('schedule limits', () => {
  it('saves the global concurrency limit as an explicit owner command', async () => {
    const scheduling = vi.fn(async () => ({ spec: null, enabled: false, revision: 1, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }))
    installWorkspace({ scheduling })
    await mountApp()
    const input = wrapper!.findAll('label').find(item => item.text().includes('Concurrent pods on this Mac'))!.get('input')
    await input.setValue(3)
    await wrapper!.get('.limit-form').trigger('submit'); await flushPromises()
    expect(scheduling).toHaveBeenCalledWith({ type: 'concurrency', podId, maximum: 3 })
  })
})
