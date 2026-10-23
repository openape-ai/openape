// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, markRaw } from 'vue'
import AccountStatus from '../src/renderer/AccountStatus.vue'
import StorageGate from '../src/renderer/StorageGate.vue'
import { hostBridgeKey } from '../src/renderer/host-bridge'
import type { ExecutionStatus, PodStatus, PodsBridge, WorkerStatus } from '../src/contracts/ipc'
import type { ConnectionView, OnboardingCommand, OnboardingView } from '../src/contracts/onboarding'

const ownerId = '00000000-0000-4000-8000-000000000002'
const supported: ExecutionStatus = { supported: true, compatibility: 'verified', kernel: '25.6.0', architecture: 'arm64', system: '26.6.2', verified: ['Darwin 25.6.0 (macOS 26.6.2)', 'Darwin 27.0.0 (macOS 27.0.1)'], reason: null }
// A future, explicitly unverified kernel; the verified list mirrors src/main/support.ts.
const blocked: ExecutionStatus = { supported: false, compatibility: 'unverified', kernel: '99.0.0', architecture: 'arm64', system: '99.0', verified: ['Darwin 25.6.0 (macOS 26.6.2)', 'Darwin 27.0.0 (macOS 27.0.1)'], reason: 'Pod execution is blocked on darwin 99.0.0 (arm64): only Apple silicon with a verified Darwin kernel (Darwin 25.6.0 (macOS 26.6.2), Darwin 27.0.0 (macOS 27.0.1)) passed the packaged sandbox boundary acceptance' }
const status = (worker: Partial<WorkerStatus> = {}, execution = supported, mode: PodStatus['mode'] = 'local'): PodStatus => ({ version: 1, mode, executionEnabled: true, execution, worker: { state: 'ready', pid: 42, error: null, ...worker }, runtime: { electron: '40.9.3', node: '24.14.1' } })
const view = (owner?: Partial<ConnectionView>): OnboardingView => ({ connections: owner ? [{ id: ownerId, provider: 'openape', account: 'owner@example.invalid', state: 'ready', error: null, login: null, ...owner }] : [], owner: owner ? ownerId : null, runtime: { ready: true, error: null }, complete: true })
const Workspace = defineComponent({ template: '<p data-testid="workspace">Workspace</p>' })

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers() })

function host(initial: PodStatus, account: (command: OnboardingCommand) => Promise<OnboardingView>) {
  let current = initial
  const listeners: ((next: PodStatus) => void)[] = []
  const bridge = {
    getStatus: vi.fn(async () => current),
    onStatus: (listener: (next: PodStatus) => void) => { listeners.push(listener); return () => {} },
    onboarding: vi.fn(account),
    restart: vi.fn(async () => { current = status({ state: 'starting', error: null }); return current }),
  }
  return { bridge, publish(next: PodStatus) { current = next; for (const listener of listeners) listener(next) } }
}
async function open(bridge: Partial<PodsBridge>) {
  wrapper = mount(StorageGate, { props: { shell: Workspace }, global: { provide: { [hostBridgeKey as symbol]: bridge } } })
  await flushPromises()
  return wrapper
}
const screen = () => wrapper!.find('.startup-screen').attributes('data-state')
const buttons = () => wrapper!.findAll('.startup-screen button').map(button => button.text())
async function press(label: string) {
  const button = wrapper!.findAll('button').find(item => item.text() === label)
  if (!button) throw new Error(`Missing button ${label}: ${buttons().join(', ')}`)
  await button.trigger(button.attributes('type') === 'button' ? 'click' : 'submit'); await flushPromises()
}

it('shows only the DDISA sign-in before authentication and follows the real sign-in commands into the workspace', async () => {
  vi.useFakeTimers()
  let account = view()
  const { bridge } = host(status(), async (command) => {
    if (command.type === 'connect') account = view({ state: 'connecting', login: { url: 'https://id.example.invalid/device', code: 'KXQ-472' } })
    if (command.type === 'cancel') account = view({ state: 'failed', error: 'Sign-in cancelled by the owner' })
    return account
  })
  await open(bridge)
  expect(screen()).toBe('signed-out')
  expect(buttons()).toEqual(['Sign in with DDISA'])
  expect(wrapper!.findAll('input')).toHaveLength(1)
  expect(wrapper!.text()).not.toMatch(/Codex|Automation|Settings|Decisions|TypeSafe/)
  expect(wrapper!.find('[data-testid="workspace"]').exists()).toBe(false)
  await wrapper!.get('input[type="email"]').setValue(' owner@example.invalid ')
  await press('Sign in with DDISA')
  expect(bridge.onboarding).toHaveBeenLastCalledWith({ type: 'connect', provider: 'openape', account: 'owner@example.invalid' })
  expect(screen()).toBe('browser-pending')
  expect(wrapper!.get('.startup-code').text()).toContain('KXQ-472')
  await press('Open browser again')
  expect(bridge.onboarding).toHaveBeenLastCalledWith({ type: 'openLogin', id: ownerId })
  await press('Cancel sign-in')
  expect(bridge.onboarding).toHaveBeenLastCalledWith({ type: 'cancel', id: ownerId })
  expect(screen()).toBe('sign-in-incomplete')
  expect(wrapper!.get('[role="alert"]').text()).toContain('cancelled or expired')
  await press('Sign in again')
  expect(bridge.onboarding).toHaveBeenLastCalledWith({ type: 'connect', provider: 'openape', account: 'owner@example.invalid' })
  account = view({ state: 'ready' })
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(wrapper!.find('[data-testid="workspace"]').exists()).toBe(true)
  const calls = bridge.onboarding.mock.calls.length
  await vi.advanceTimersByTimeAsync(5000)
  expect(bridge.onboarding).toHaveBeenCalledTimes(calls)
})

it('names an unreachable DDISA service with its cause and retries the same address or another one', async () => {
  const { bridge } = host(status(), async (command) => {
    if (command.type === 'connect') throw new Error('Error invoking remote method \'pods:onboarding\': Error: Could not look up the DDISA identity provider of example.invalid: fetch failed (ENOTFOUND)')
    return view()
  })
  await open(bridge)
  await wrapper!.get('input[type="email"]').setValue('owner@example.invalid')
  await press('Sign in with DDISA')
  expect(screen()).toBe('service-unreachable')
  expect(wrapper!.get('.startup-detail').text()).toContain('fetch failed (ENOTFOUND)')
  expect(buttons()).toEqual(['Try again', 'Use another address'])
  await press('Try again')
  expect(bridge.onboarding).toHaveBeenLastCalledWith({ type: 'connect', provider: 'openape', account: 'owner@example.invalid' })
  await press('Use another address')
  expect(screen()).toBe('signed-out')
  expect((wrapper!.get('input[type="email"]').element as HTMLInputElement).value).toBe('owner@example.invalid')
})

it('reports a non-network sign-in failure with its cause instead of a generic connection error', async () => {
  const { bridge } = host(status(), async () => view({ state: 'failed', error: 'Owner identity does not match the requested account' }))
  await open(bridge)
  expect(screen()).toBe('sign-in-incomplete')
  expect(wrapper!.get('[role="alert"]').text()).toContain('The details below name the cause')
  expect(wrapper!.get('.startup-detail').text()).toContain('Owner identity does not match the requested account')
})

it('restarts a stopped local service once per request and names the cause', async () => {
  const { bridge, publish } = host(status({ state: 'error', pid: null, error: 'Worker exited (1). Quit and reopen Pods to recover.' }), async () => view())
  let finish: () => void = () => undefined
  bridge.restart.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(status({ state: 'starting' })) }))
  await open(bridge)
  expect(screen()).toBe('local-start-failed')
  expect(wrapper!.get('.startup-detail').text()).toContain('Worker exited (1)')
  expect(bridge.onboarding).not.toHaveBeenCalled()
  await press('Restart service'); await press('Restart service')
  expect(bridge.restart).toHaveBeenCalledTimes(1)
  finish(); await flushPromises()
  expect(screen()).toBe('checking')
  publish(status()); await flushPromises()
  await vi.waitFor(() => expect(screen()).toBe('signed-out'), { timeout: 3000 })
})

it('names the account service failure when the first account state cannot be read', async () => {
  const { bridge } = host(status(), async () => { throw new Error('Connection service unavailable (ready): Account service setup failed: Gateway port unavailable') })
  await open(bridge)
  expect(screen()).toBe('local-start-failed')
  expect(wrapper!.get('.startup-detail').text()).toContain('Gateway port unavailable')
  await press('Restart service')
  expect(bridge.restart).toHaveBeenCalledTimes(1)
})

it('stops waiting after the startup limit and checks again on request', async () => {
  vi.useFakeTimers()
  const { bridge } = host(status({ state: 'starting' }), async () => view())
  await open(bridge)
  expect(screen()).toBe('checking')
  expect(buttons()).toEqual([])
  await vi.advanceTimersByTimeAsync(59000)
  expect(screen()).toBe('checking')
  await vi.advanceTimersByTimeAsync(1000)
  expect(screen()).toBe('local-start-failed')
  expect(wrapper!.get('.startup-detail').text()).toContain('starting')
  await press('Check again')
  expect(bridge.getStatus).toHaveBeenCalledTimes(2)
  expect(screen()).toBe('checking')
})

it('allows sign-in on an unverified Mac and then states once that automations are blocked', async () => {
  let account = view()
  const { bridge } = host(status({}, blocked), async (command) => { if (command.type === 'connect') account = view({ state: 'ready' }); return account })
  await open(bridge)
  expect(screen()).toBe('signed-out')
  await wrapper!.get('input[type="email"]').setValue('owner@example.invalid')
  await press('Sign in with DDISA')
  expect(screen()).toBe('unsupported-runtime')
  expect(wrapper!.get('[role="alert"]').text()).toContain('no Pod starts')
  expect(wrapper!.get('.startup-facts').text()).toContain('macOS 99.0 · Darwin 99.0.0 (arm64)')
  expect(wrapper!.get('.startup-facts').text()).toContain('Darwin 25.6.0 (macOS 26.6.2), Darwin 27.0.0 (macOS 27.0.1)')
  expect(wrapper!.get('.startup-detail').text()).toContain('Pod execution is blocked on darwin 99.0.0')
  expect(buttons()).toEqual(['Continue without automations'])
  await press('Continue without automations')
  expect(wrapper!.find('[data-testid="workspace"]').exists()).toBe(true)
})

it('keeps the result of a newer owner action when an older account read answers later', async () => {
  let release: (value: OnboardingView) => void = () => undefined
  const { bridge } = host(status(), async () => view())
  await open(bridge)
  bridge.onboarding.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  const vm = wrapper!.vm as unknown as { request: (command: OnboardingCommand) => Promise<boolean> }
  const stale = vm.request({ type: 'list' })
  bridge.onboarding.mockResolvedValueOnce(view({ state: 'connecting', login: { url: 'https://id.example.invalid/device' } }))
  await wrapper!.get('input[type="email"]').setValue('owner@example.invalid')
  await press('Sign in with DDISA')
  expect(screen()).toBe('browser-pending')
  release(view()); await stale; await flushPromises()
  expect(screen()).toBe('browser-pending')
})

it('opens the workspace directly for a signed-in owner and for synthetic fixture profiles', async () => {
  await open(host(status(), async () => view({ state: 'ready' })).bridge)
  expect(wrapper!.find('[data-testid="workspace"]').exists()).toBe(true)
  wrapper!.unmount()
  const fixture = host(status({}, supported, 'fixture'), async () => view())
  await open(fixture.bridge)
  expect(wrapper!.find('[data-testid="workspace"]').exists()).toBe(true)
  expect(fixture.bridge.onboarding).not.toHaveBeenCalled()
})

it('drops an account read issued before an owner action even when it answers before that action', async () => {
  const { bridge } = host(status(), async () => view())
  await open(bridge)
  let releaseRead: (value: OnboardingView) => void = () => undefined
  let releaseConnect: (value: OnboardingView) => void = () => undefined
  bridge.onboarding.mockImplementationOnce(() => new Promise((resolve) => { releaseRead = resolve }))
  const vm = wrapper!.vm as unknown as { request: (command: OnboardingCommand) => Promise<boolean> }
  const read = vm.request({ type: 'list' })
  bridge.onboarding.mockImplementationOnce(() => new Promise((resolve) => { releaseConnect = resolve }))
  await wrapper!.get('input[type="email"]').setValue('owner@example.invalid')
  const submitted = press('Sign in with DDISA')
  releaseRead(view({ state: 'failed', error: 'Older failure' })); await read; await flushPromises()
  expect(wrapper!.text()).not.toContain('Older failure')
  releaseConnect(view({ state: 'connecting', login: { url: 'https://id.example.invalid/device' } })); await submitted
  expect(screen()).toBe('browser-pending')
})

it('shows a failed first status read with its cause and resumes once the status is readable', async () => {
  const { bridge } = host(status(), async () => view())
  bridge.getStatus.mockRejectedValueOnce(new Error('Error invoking remote method \'pods:status\': Error: Rejected Pods status request'))
  await open(bridge)
  expect(screen()).toBe('local-start-failed')
  expect(wrapper!.get('.startup-detail').text()).toContain('Rejected Pods status request')
  await press('Check again')
  expect(screen()).toBe('signed-out')
})

it('keeps a failed browser step visible while the sign-in still waits, with reopen and cancel available', async () => {
  const { bridge } = host(status(), async (command) => {
    if (command.type === 'openLogin') throw new Error('Sign-in expired; start again')
    return view({ state: 'connecting', login: { url: 'https://id.example.invalid/device', code: 'KXQ-472' } })
  })
  await open(bridge)
  await press('Open browser again')
  expect(screen()).toBe('browser-pending')
  expect(wrapper!.get('[role="alert"]').text()).toContain('The last sign-in step failed')
  expect(wrapper!.get('.startup-detail').text()).toContain('Sign-in expired; start again')
  expect(buttons()).toEqual(['Open browser again', 'Cancel sign-in'])
})

it('closes the open workspace when its account button reads a disconnected owner, without a second account poll', async () => {
  let account = view({ state: 'ready' })
  const { bridge } = host(status(), async () => account)
  wrapper = mount(StorageGate, { props: { shell: markRaw(AccountStatus) }, global: { provide: { [hostBridgeKey as symbol]: bridge } } })
  await flushPromises()
  expect(wrapper.find('.account-status').exists()).toBe(true)
  expect((wrapper.vm as unknown as { timer: unknown }).timer).toBeNull()
  account = view({ state: 'revoked' })
  await vi.waitFor(() => expect(wrapper!.find('.startup-screen').exists()).toBe(true), { timeout: 3000 })
  expect(screen()).toBe('signed-out')
})
