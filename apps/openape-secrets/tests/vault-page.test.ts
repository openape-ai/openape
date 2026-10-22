// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VaultPage from '../app/pages/vault.vue'

vi.mock('../app/components/VaultPanel.vue', () => ({ default: { template: '<main>Vault controls</main>' } }))
const stubs = {
  // The actual login card has no default slot. A slot-forwarding stub would
  // conceal the regression where the vault was incorrectly nested inside it.
  OpenApeAuth: { template: '<section>Sign in</section>' },
  ClientOnly: { template: '<slot />' },
}
afterEach(() => vi.unstubAllGlobals())

describe('vault page session boundary', () => {
  it('waits for session verification, then mounts the vault without the login card', async () => {
    const user = ref<null | { sub: string }>(null)
    let finish!: () => void
    const fetchUser = vi.fn(() => new Promise<void>((resolve) => {
      finish = () => { user.value = { sub: 'owner@example.test' }; resolve() }
    }))
    vi.stubGlobal('useOpenApeAuth', () => ({ user, fetchUser }))
    const wrapper = mount(VaultPage, { global: { stubs } })
    expect(wrapper.text()).toContain('Checking your session')
    expect(wrapper.find('main').exists()).toBe(false)
    finish(); await flushPromises()
    expect(wrapper.get('main').text()).toBe('Vault controls')
    expect(wrapper.find('section').exists()).toBe(false)
    expect(fetchUser).toHaveBeenCalledOnce()
    user.value = null; await flushPromises()
    expect(wrapper.find('main').exists()).toBe(false)
    expect(wrapper.get('section').text()).toBe('Sign in')
    wrapper.unmount()
  })

  it('shows only the login card when there is no authenticated session', async () => {
    vi.stubGlobal('useOpenApeAuth', () => ({ user: ref(null), fetchUser: vi.fn().mockResolvedValue(undefined) }))
    const wrapper = mount(VaultPage, { global: { stubs } })
    await flushPromises()
    expect(wrapper.get('section').text()).toBe('Sign in')
    expect(wrapper.find('main').exists()).toBe(false)
    wrapper.unmount()
  })
})
