// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VaultPanel from '../app/components/VaultPanel.vue'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), authenticate: vi.fn(), register: vi.fn(), call: vi.fn(), dispose: vi.fn() }))
vi.mock('../app/utils/vault-browser', () => ({ authenticate: mocks.authenticate, register: mocks.register, vaultWorker: () => ({ call: mocks.call, dispose: mocks.dispose }) }))
const view = () => ({ owner: 'human@example.org', vault: {}, credentials: [{ id: 'credential' }], secrets: [], consumers: [{ id: 'machine', publicKey: {}, fingerprint: 'fingerprint', collector: 'agent@example.org' }], registeredConsumers: [], requests: [{ id: 'request', status: 'pending', expiresAt: Date.now() + 60000, requester: 'agent@example.org', consumerId: 'machine', fingerprint: 'fingerprint', secretId: 'new:API_TOKEN', version: 0, purpose: '<script>untrusted reason</script>' }], approvals: [] })
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('$fetch', mocks.fetch)
  mocks.fetch.mockImplementation(async (path: string) => path === '/api/v2/vault' ? view() : path.endsWith('/options') ? { challengeId: 'challenge', credentialId: 'credential', wrapper: {}, action: { descriptor: {} } } : {})
  mocks.authenticate.mockResolvedValue({ response: { id: 'credential' }, prf: new Uint8Array(32) })
  mocks.call.mockResolvedValue({ format: 'encrypted-envelope' })
})
describe('vault interactions', () => {
  it('shows agent identity, fingerprint and untrusted purpose as text, defaults to once', async () => {
    const wrapper = mount(VaultPanel); await flushPromises()
    expect(wrapper.text()).toContain('agent@example.org')
    expect(wrapper.text()).toContain('fingerprint')
    expect(wrapper.text()).toContain('<script>untrusted reason</script>')
    expect(wrapper.findAll('script')).toHaveLength(0)
    const release = wrapper.findAll('select').find(s => s.text().includes('Once'))!
    expect(release.element.value).toBe('once')
    wrapper.unmount()
  })
  it('sends only sealed data after a passkey release and clears value inputs', async () => {
    const wrapper = mount(VaultPanel); await flushPromises()
    const input = wrapper.findAll('input[type="password"]')[1]!
    await input.setValue('never-in-api')
    await wrapper.findAll('button').find(b => b.text() === 'Release with passkey')!.trigger('click')
    await flushPromises()
    expect(mocks.authenticate).toHaveBeenCalledOnce()
    const commit = mocks.fetch.mock.calls.find(c => c[0] === '/api/v2/actions/commit')
    expect(commit?.[1].body.envelope).toEqual({ format: 'encrypted-envelope' })
    expect(JSON.stringify(mocks.fetch.mock.calls)).not.toContain('never-in-api')
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(mocks.dispose).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  it('reveals a stored value only locally after verification and allows immediate hiding', async () => {
    const v = { ...view(), secrets: [{ id: 'stored', alias: 'TOKEN', version: 1, payload: {} }] }
    mocks.fetch.mockImplementation(async (path: string) => path === '/api/v2/vault' ? v : path.endsWith('/options') ? { challengeId: 'challenge', credentialId: 'credential', wrapper: {}, action: {} } : {})
    mocks.call.mockResolvedValue('locally-revealed-secret')
    const wrapper = mount(VaultPanel); await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === 'Reveal for 30 seconds')!.trigger('click'); await flushPromises()
    expect(wrapper.get('pre').text()).toBe('locally-revealed-secret')
    expect(JSON.stringify(mocks.fetch.mock.calls)).not.toContain('locally-revealed-secret')
    await wrapper.findAll('button').find(b => b.text() === 'Hide value')!.trigger('click')
    expect(wrapper.find('pre').exists()).toBe(false)
    wrapper.unmount()
  })
  it('does not approve when the user cancels a passkey prompt', async () => {
    mocks.authenticate.mockRejectedValueOnce(new Error('Passkey cancelled'))
    const wrapper = mount(VaultPanel); await flushPromises()
    await wrapper.findAll('input[type="password"]')[1]!.setValue('private')
    await wrapper.findAll('button').find(b => b.text() === 'Release with passkey')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Passkey cancelled')
    expect(mocks.fetch.mock.calls.some(c => c[0] === '/api/v2/actions/commit')).toBe(false)
    expect(mocks.dispose).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  it('requires saved recovery acknowledgement before completing setup', async () => {
    mocks.fetch.mockImplementation(async (path: string) => path === '/api/v2/vault' ? { ...view(), vault: null } : { challengeId: 'challenge', credentialId: 'credential', options: {} })
    mocks.call.mockResolvedValue({ code: 'offline-recovery-code', wrapper: {}, recovery: {} })
    const wrapper = mount(VaultPanel); await flushPromises()
    await wrapper.get('button').trigger('click'); await flushPromises()
    const finish = wrapper.findAll('button').find(b => b.text() === 'Finish setup')!
    expect(finish.attributes('disabled')).toBeDefined()
    expect(mocks.fetch.mock.calls.some(c => c[0] === '/api/v2/setup/confirm')).toBe(false)
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await finish.trigger('click'); await flushPromises()
    expect(mocks.fetch.mock.calls.some(c => c[0] === '/api/v2/setup/confirm')).toBe(true)
    expect(wrapper.text()).not.toContain('offline-recovery-code')
    wrapper.unmount()
  })
})
