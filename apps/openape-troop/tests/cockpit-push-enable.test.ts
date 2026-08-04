// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { computed, onMounted, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import ChatPage from '../app/pages/chat.vue'
import de from '../i18n/locales/de.json'

const i18n = createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de } })

// Nuxt auto-imports resolve as globals here; the app injects the real ones.
vi.stubGlobal('useI18n', () => i18n.global)
vi.stubGlobal('definePageMeta', () => {})
vi.stubGlobal('useHead', () => {})
vi.stubGlobal('useRuntimeConfig', () => ({ public: { vapidPublicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' } }))
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('onMounted', onMounted)

const apiPost = vi.fn()
vi.stubGlobal('$fetch', apiPost)
vi.stubGlobal('PushManager', class {})
vi.stubGlobal('Notification', { permission: 'default', requestPermission: async () => 'granted' })

const pushManager = { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => ({ toJSON: () => ({ endpoint: 'https://push.example/abc' }) })) }
const registration = { pushManager }
Object.defineProperty(navigator, 'serviceWorker', {
  value: { register: vi.fn(async () => registration), ready: Promise.resolve(registration) },
  configurable: true,
})

beforeEach(() => {
  apiPost.mockReset()
  pushManager.getSubscription.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// The server refusing the subscription used to end here: the promise rejected
// unhandled, the button just re-enabled itself, and notifications stayed off
// without a word.
describe('cockpit push opt-in', () => {
  it('says so when the subscription cannot be stored', async () => {
    apiPost.mockRejectedValue(new Error('500 subscribe failed'))
    const wrapper = mount(ChatPage, { global: { plugins: [i18n], stubs: { CockpitChat: true } } })
    await flushPromises()

    const button = wrapper.get('button.push-enable')
    await button.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Benachrichtigungen konnten nicht aktiviert werden')
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('hides the button once the subscription is stored', async () => {
    apiPost.mockResolvedValue({ ok: true })
    const wrapper = mount(ChatPage, { global: { plugins: [i18n], stubs: { CockpitChat: true } } })
    await flushPromises()

    await wrapper.get('button.push-enable').trigger('click')
    await flushPromises()

    expect(wrapper.find('button.push-enable').exists()).toBe(false)
    expect(wrapper.find('.push-error').exists()).toBe(false)
  })
})
