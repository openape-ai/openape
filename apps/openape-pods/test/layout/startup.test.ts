import { screenshotPath } from './evidence'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, markRaw } from 'vue'
import StartupScreen from '../../src/renderer/StartupScreen.vue'
import StorageGate from '../../src/renderer/StorageGate.vue'
import { hostBridgeKey } from '../../src/renderer/host-bridge'
import { applyLanguage } from '../../src/renderer/i18n'
import { startupState } from '../../src/renderer/startup'
import type { StartupInput, StartupStateId } from '../../src/renderer/startup'
import type { ExecutionStatus, PodStatus, WorkerStatus } from '../../src/contracts/ipc'
import type { ConnectionView, OnboardingCommand, OnboardingView } from '../../src/contracts/onboarding'

// The startup gate with the production stylesheet: every state the actual mapping produces shows one status and one
// large primary action, fits narrow and dark windows, and the real gate walks sign-in, cancellation and retry.
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
const ownerId = '00000000-0000-4000-8000-000000000002'
const supported: ExecutionStatus = { supported: true, compatibility: 'verified', kernel: '25.6.0', architecture: 'arm64', system: '26.6.2', verified: ['Darwin 25.6.0 (macOS 26.6.2)', 'Darwin 27.0.0 (macOS 27.0.1)'], reason: null }
// A future, explicitly unverified kernel; the verified list mirrors src/main/support.ts.
const blocked: ExecutionStatus = { supported: false, compatibility: 'unverified', kernel: '99.0.0', architecture: 'arm64', system: '99.0', verified: ['Darwin 25.6.0 (macOS 26.6.2)', 'Darwin 27.0.0 (macOS 27.0.1)'], reason: 'Pod execution is blocked on darwin 99.0.0 (arm64): only Apple silicon with a verified Darwin kernel (Darwin 25.6.0 (macOS 26.6.2), Darwin 27.0.0 (macOS 27.0.1)) passed the packaged sandbox boundary acceptance' }
const status = (worker: Partial<WorkerStatus> = {}, execution = supported): PodStatus => ({ version: 1, mode: 'local', executionEnabled: true, execution, worker: { state: 'ready', pid: 42, error: null, ...worker }, runtime: { electron: '40.9.3', node: '24.14.1' } })
const view = (owner?: Partial<ConnectionView>): OnboardingView => ({ connections: owner ? [{ id: ownerId, provider: 'openape', account: 'owner.with.a.long.address@example.invalid', state: 'ready', error: null, login: null, ...owner }] : [], owner: owner ? ownerId : null, runtime: { ready: true, error: null }, complete: true })
const base: StartupInput = { status: status(), view: view(), error: '', errorSource: null, overdue: false, editing: false, continued: false, email: '' }
const inputs: Record<Exclude<StartupStateId, 'signed-in'>, Partial<StartupInput>> = {
  'checking': { status: status({ state: 'starting' }) },
  'signed-out': {},
  'browser-pending': { view: view({ state: 'connecting', login: { url: 'https://id.example.invalid/device', code: 'KXQ-472' } }) },
  'sign-in-incomplete': { view: view({ state: 'failed', error: 'Sign-in expired; start again' }) },
  'service-unreachable': { error: 'Could not look up the DDISA identity provider of example.invalid: fetch failed (ENOTFOUND)', errorSource: 'action', email: 'owner@example.invalid' },
  'local-start-failed': { status: status({ state: 'error', pid: null, error: 'Worker exited (1). Quit and reopen Pods to recover.' }) },
  'unsupported-runtime': { status: status({}, blocked), view: view({ state: 'ready' }) },
  'session-expired': { view: view({ state: 'expired' }) },
}
let wrapper: VueWrapper | undefined
let host: HTMLElement | undefined
afterEach(() => { wrapper?.unmount(); host?.remove(); wrapper = undefined; document.documentElement.style.colorScheme = ''; applyLanguage('en') })
function attach() { host = document.createElement('div'); document.body.append(host); return host }
async function show(width: number, height: number, scheme: 'light' | 'dark' = 'light') { await page.viewport(width, height); document.documentElement.style.colorScheme = scheme; await frame() }
async function render(id: keyof typeof inputs) {
  wrapper?.unmount(); host?.remove()
  const state = startupState({ ...base, ...inputs[id] })
  expect(state.id).toBe(id)
  wrapper = mount(StartupScreen, { attachTo: attach(), props: { state } }); await frame()
}
const screenButtons = () => wrapper!.findAll('.startup-screen button').map(button => button.text().trim())

describe('startup and sign-in gate', () => {
  it.each([[1060, 850, 'desktop'], [560, 760, 'compact']] as const)('renders each actual state with one status and a large primary action at %i px', async (width, height, name) => {
    await show(width, height)
    for (const id of Object.keys(inputs) as (keyof typeof inputs)[]) {
      await render(id)
      expect(document.querySelectorAll('[role="status"], [role="alert"]'), id).toHaveLength(1)
      expect(document.querySelectorAll('h1'), id).toHaveLength(1)
      expect(document.documentElement.scrollWidth, `${id} fits`).toBeLessThanOrEqual(innerWidth)
      for (const label of Array.from(document.querySelectorAll<HTMLElement>('.startup-facts dt'))) {
        const text = document.createRange(); text.selectNodeContents(label)
        expect(new Set(Array.from(text.getClientRects(), line => Math.round(line.top))).size, `${id} ${label.textContent} stays on one line`).toBe(1)
      }
      const primary = document.querySelector<HTMLElement>('.startup-primary')
      if (id === 'checking') expect(primary, id).toBeNull()
      else expect(primary!.getBoundingClientRect().height, `${id} primary height`).toBeGreaterThanOrEqual(48)
      await page.screenshot({ path: screenshotPath(`startup-${id}-${name}.png`) })
    }
  })

  it('offers neither retry nor sign-in where neither can help, and keeps the cause behind details', async () => {
    await render('unsupported-runtime')
    expect(screenButtons()).toEqual(['Continue without automations'])
    expect(wrapper!.get('.startup-facts').text()).toContain('Darwin 99.0.0')
    expect(wrapper!.get('.fact-bad').text()).toBe('Blocked')
    const details = wrapper!.get<HTMLDetailsElement>('.startup-detail')
    expect(details.element.open).toBe(false)
    expect(details.get('code').element.checkVisibility()).toBe(false)
    await render('checking')
    expect(screenButtons()).toEqual([])
  })

  it.each(['signed-out', 'unsupported-runtime', 'browser-pending'] as const)('fits a compact dark German window (%s)', async (id) => {
    applyLanguage('de')
    await show(560, 760, 'dark')
    await render(id)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
    expect(getComputedStyle(document.querySelector('.startup-screen')!).backgroundColor).not.toBe('rgb(255, 255, 255)')
    await page.screenshot({ path: screenshotPath(`startup-${id}-compact-dark-de.png`) })
  })

  it('walks the real gate from sign-in through cancellation and retry into the workspace', async () => {
    await show(1060, 850)
    let account = view()
    const commands: OnboardingCommand[] = []
    const bridge = {
      getStatus: async () => status(),
      onStatus: () => () => {},
      onboarding: async (command: OnboardingCommand) => {
        commands.push(command)
        if (command.type === 'connect') account = commands.filter(item => item.type === 'connect').length === 1 ? view({ state: 'connecting', login: { url: 'https://id.example.invalid/device', code: 'KXQ-472' } }) : view({ state: 'ready' })
        if (command.type === 'cancel') account = view({ state: 'failed', error: 'Sign-in cancelled by the owner' })
        return account
      },
    }
    const Workspace = markRaw(defineComponent({ render: () => h('p', { 'data-testid': 'workspace' }, 'Workspace') }))
    wrapper = mount(StorageGate, { attachTo: attach(), props: { shell: Workspace }, global: { provide: { [hostBridgeKey as symbol]: bridge } } })
    await flushPromises(); await frame()
    const state = () => wrapper!.find('.startup-screen').attributes('data-state')
    expect(state()).toBe('signed-out')
    await wrapper.get('input[type="email"]').setValue('owner@example.invalid')
    await wrapper.get('form').trigger('submit'); await flushPromises(); await frame()
    expect(state()).toBe('browser-pending')
    await page.screenshot({ path: screenshotPath('startup-gate-pending.png') })
    await wrapper.findAll('button').find(button => button.text() === 'Cancel sign-in')!.trigger('click'); await flushPromises(); await frame()
    expect(state()).toBe('sign-in-incomplete')
    await wrapper.get('form').trigger('submit'); await flushPromises(); await frame()
    expect(wrapper.find('[data-testid="workspace"]').exists()).toBe(true)
    expect(commands.filter(item => item.type !== 'list')).toEqual([
      { type: 'connect', provider: 'openape', account: 'owner@example.invalid' },
      { type: 'cancel', id: ownerId },
      { type: 'connect', provider: 'openape', account: 'owner.with.a.long.address@example.invalid' },
    ])
  })
})
