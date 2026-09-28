import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import DesktopWorkspace from '../../src/renderer/central/DesktopWorkspace.vue'
import type { CentralStatus } from '../../src/contracts/central'
import type { McpAccess } from '../../src/contracts/mcp-access'
import type { WorkflowView } from '../../src/contracts/workflows'
import { applyLanguage } from '../../src/renderer/i18n'
import { scriptBuffer } from '../../src/renderer/script-buffer'
import { installWorkspace, pods, podId } from './workspace-fixture'
import { centralFixture } from '../workspace/central-fixture'
import { screenshotPath } from './evidence'

let wrapper: VueWrapper | undefined
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en'); document.documentElement.style.colorScheme = '' })
function fixture() {
  const central = centralFixture()
  const standalone = { ...pods[0]!, id: '00000000-0000-4000-8000-000000000003', name: 'Release notes' }
  const inventory = [...structuredClone(pods), standalone]
  central.host.workspace.pods = inventory.map(pod => ({ ...pod, online: true }))
  const workflows: WorkflowView = { workflows: [{ id: '00000000-0000-4000-8000-000000000004', revision: 1, name: 'Morning review', nodes: [{ podId, after: [], handoff: false }], schedule: { kind: 'daily', time: '09:00', timezone: 'Europe/Vienna' }, enabled: true, paused: false, nextAt: 1790665200000 }], runs: [] }
  const status: CentralStatus = { state: 'online', runtimeId: central.host.id, error: null, since: 1790000000000, lastOnlineAt: 1790000000000, gateUntil: 0, lastTickAt: null, tickingSince: null, tickPhase: null, tickTimeout: null, format: 2, lastPublication: null }
  let access: McpAccess = { mode: 'off', duration: 'hour', expiresAt: null }
  const bridge = installWorkspace({
    workspace: async () => ({ organization: { revision: 1, groups: [] }, pods: structuredClone(inventory) }),
    workflows: async () => structuredClone(workflows),
    onboarding: async () => ({ owner: 'owner', complete: true, runtime: { ready: true, error: null }, connections: [{ id: 'owner', provider: 'openape', state: 'ready', account: 'owner@example.invalid', error: null, login: null }, { id: 'codex', provider: 'chatgpt', state: 'ready', account: 'AI account', error: null, login: null }] }),
    mcpAccess: async (command) => { if (command.type === 'set') access = { mode: command.mode, duration: command.duration, expiresAt: command.mode === 'off' || command.duration === 'permanent' ? null : 1790614800000 }; return { ...access } },
    central: async (command) => {
      if (command.type === 'status') return { ...status, enabled: true }
      if (command.type === 'inventory') return [structuredClone(central.host)]
      if (command.type === 'read') { const pod = inventory.find(pod => pod.id === command.podId)!; return { revision: 1, total: 1, pod: { ...structuredClone(central.view), id: pod.id, scripts: { ...central.view.scripts, pod } } } }
      return { requestError: { status: 400, message: 'No fixture change feed' } }
    },
  })
  scriptBuffer(podId).view = null
  return { bridge, central, status }
}
async function open() {
  fixture(); applyLanguage('de'); document.documentElement.style.colorScheme = 'light'
  await page.viewport(1280, 1000)
  wrapper = mount(DesktopWorkspace, { attachTo: document.body }); await flushPromises(); await frame()
}
async function navigate(index: number) { await wrapper!.findAll('.workspace-navigation nav button')[index]!.trigger('click'); await flushPromises(); await frame() }
async function shot(name: string) { await frame(); expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth); await page.screenshot({ path: screenshotPath(name) }) }
it('shows workflows first and inventories standalone, workflow and archived Pods separately', async () => {
  await open()
  expect(wrapper!.get('.workflow-inventory strong').text()).toBe('Morning review')
  await wrapper!.get('.workflow-inventory button').trigger('click'); await flushPromises()
  expect(wrapper!.get('.workflow-node').text()).toContain('Mail knowledge')
  await shot('variant-a-workflow.png')
  await navigate(1)
  expect(wrapper!.findAll('.central-pod')).toHaveLength(2)
  expect(wrapper!.findAll('.central-pod')[0]!.text()).toContain('Morning review')
  expect(wrapper!.findAll('.central-pod')[1]!.text()).toContain('Eigenständiger Pod')
  expect(wrapper!.get('.central-inventory').text()).not.toContain('Archived research')
  await shot('variant-a-pods.png')
  await wrapper!.findAll('.inventory-toolbar button')[1]!.trigger('click'); await flushPromises()
  expect(wrapper!.findAll('.central-pod')).toHaveLength(1)
  expect(wrapper!.get('.central-pod').text()).toContain('Archived research')
  await shot('variant-a-archive.png')
  await wrapper!.get('.central-pod').trigger('click'); await flushPromises()
  expect(wrapper!.get('.central-content h1').text()).toBe('Archived research')
  expect(wrapper!.findAll('button').find(button => button.text() === 'Jetzt ausführen')?.attributes('disabled')).toBeDefined()
})
it('opens the native highlighted editor from a workflow and keeps MCP out of Pod sections', async () => {
  await open()
  await wrapper!.get('.workflow-inventory button').trigger('click'); await flushPromises()
  await wrapper!.get('.workflow-node').trigger('click'); await flushPromises(); await frame()
  expect(wrapper!.get('.central-content h1').text()).toBe('Mail knowledge')
  const tabs = () => wrapper!.findAll('[role="tab"]')
  await tabs()[1]!.trigger('click'); await flushPromises()
  expect(wrapper!.get('.code-editor .keyword').text()).toBe('export')
  expect(wrapper!.find('.central-content .mcp-access').exists()).toBe(false)
  await shot('variant-a-script.png')
  await tabs()[3]!.trigger('click'); await flushPromises()
  expect(wrapper!.get('.directory-list').text()).toContain('Orders')
  await shot('variant-a-permissions.png')
  await tabs()[4]!.trigger('click'); await flushPromises()
  expect(wrapper!.get('.central-content input').element).toBeDefined()
  await shot('variant-a-pod-settings.png')
  await tabs()[5]!.trigger('click'); await flushPromises()
  expect(wrapper!.get('.central-content').text()).toContain('Local example completed')
  await shot('variant-a-history.png')
})
it('keeps all three accounts and MCP levels in app settings at desktop and narrow dark sizes', async () => {
  await open(); await navigate(2)
  for (const account of ['DDISA/OpenApe', 'Codex', 'TypeSafe (Jev)']) expect(wrapper!.get('.app-settings').text()).toContain(account)
  expect(wrapper!.get('.mcp-levels [aria-pressed="true"]').text()).toBe('AUS')
  await wrapper!.findAll('.mcp-levels button')[1]!.trigger('click'); await flushPromises()
  expect(wrapper!.get('.mcp-access [role="status"]').text()).toContain('MCP läuft')
  await shot('variant-a-settings.png')
  await page.viewport(560, 1000); document.documentElement.style.colorScheme = 'dark'
  wrapper!.get('.mcp-access').element.scrollIntoView({ block: 'center' }); await frame()
  const control = wrapper!.get('.mcp-levels').element.getBoundingClientRect()
  expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(560)
  await shot('variant-a-mcp-dark.png')
  await wrapper!.findAll('.mcp-levels button')[2]!.trigger('click'); await flushPromises()
  expect(wrapper!.get('.mcp-access [role="status"]').text()).toContain('ändern')
  await wrapper!.findAll('.mcp-levels button')[0]!.trigger('click'); await flushPromises()
  expect(wrapper!.get('.mcp-access [role="status"]').text()).toContain('ausgeschaltet')
})
