import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import DesktopWorkspace from '../../src/renderer/central/DesktopWorkspace.vue'
import type { CentralStatus } from '../../src/contracts/central'
import type { McpAccess } from '../../src/contracts/mcp-access'
import type { WorkflowView } from '../../src/contracts/workflows'
import { sequenceParts } from '../../src/contracts/workflows'
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
  const workflows: WorkflowView = { workflows: [{ ...sequenceParts, id: '00000000-0000-4000-8000-000000000004', revision: 1, name: 'Morning review', nodes: [{ podId, after: [], handoff: false }], schedule: { kind: 'daily', time: '09:00', timezone: 'Europe/Vienna' }, enabled: true, paused: false, nextAt: 1790665200000 }], runs: [] }
  const status: CentralStatus = { state: 'online', runtimeId: central.host.id, error: null, since: 1790000000000, lastOnlineAt: 1790000000000, gateUntil: 0, lastTickAt: null, tickingSince: null, tickPhase: null, tickTimeout: null, format: 2, lastPublication: null }
  let access: McpAccess = { mode: 'off', duration: 'hour', expiresAt: null }
  const bridge = installWorkspace({
    workspace: async () => ({ organization: { revision: 1, groups: [] }, pods: structuredClone(inventory) }),
    workflows: async () => structuredClone(workflows),
    programs: async (command) => { if (command.type === 'launchStatus') return null; throw new Error(`Unexpected program command: ${command.type}`) },
    onboarding: async () => ({ owner: 'owner', complete: true, podIdentity: { podId, bound: true, ownerConnection: 'owner', issuer: 'https://pods.example.invalid', decisionIssuer: 'https://identity.example.invalid', subject: 'mail-knowledge@pods.example.invalid', brokerConnectionId: null }, runtime: { ready: true, error: null }, connections: [{ id: 'owner', provider: 'openape', state: 'ready', account: 'owner@example.invalid', error: null, login: null }, { id: 'codex', provider: 'chatgpt', state: 'ready', account: 'AI account', error: null, login: null }] }),
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

async function shot(name: string) { await frame(); expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth); await page.screenshot({ path: screenshotPath(name) }) }
it('keeps all three accounts and MCP levels in app settings at desktop and narrow dark sizes', async () => {
  await open(); await wrapper!.get('.account-status').trigger('click'); await flushPromises(); await frame()
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
