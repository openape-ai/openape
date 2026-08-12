// The kiosk-side card: one click mints a channel and shows a scannable
// code, polling until the phone approves. The claimSecret must never be
// visible anywhere a bystander (or the QR itself) could pick it up.

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QrLogin from '../src/runtime/components/QrLogin.vue'

const global = {
  stubs: {
    // No re-emit: the native click already reaches the parent via
    // fallthrough attrs; a stub-side $emit would double every call.
    UButton: {
      props: ['label', 'loading'],
      template: '<button>{{ label }}</button>',
    },
    UAlert: { props: ['title'], template: '<div>{{ title }}</div>' },
  },
}

const CHANNEL = 'a'.repeat(64)
const SECRET = 'b'.repeat(64)

function mountCard(fetchImpl: (url: string, opts?: any) => Promise<unknown>) {
  vi.stubGlobal('$fetch', fetchImpl)
  return mount(QrLogin, { global })
}

function creation() {
  return { channelId: CHANNEL, claimSecret: SECRET, expiresIn: 120 }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('qr login card', () => {
  it('shows only the entry button until started', () => {
    const card = mountCard(async () => creation())
    expect(card.text()).toContain('Sign in with phone')
    expect(card.find('svg').exists()).toBe(false)
  })

  it('shows a scannable code that carries the channel but never the secret', async () => {
    const card = mountCard(async () => creation())
    await card.find('button').trigger('click')
    await flushPromises()

    expect(card.find('svg').exists()).toBe(true)
    expect(card.html()).not.toContain(SECRET)
  })

  it('emits signedIn once the claim succeeds', async () => {
    vi.useFakeTimers()
    let approved = false
    const card = mountCard(async (url: string) => {
      if (url === '/api/session/qr') return creation()
      return { status: approved ? 'ok' : 'pending' }
    })
    await card.find('button').trigger('click')
    await flushPromises()

    await vi.advanceTimersByTimeAsync(2000)
    expect(card.emitted('signedIn')).toBeUndefined()

    approved = true
    await vi.advanceTimersByTimeAsync(2000)
    expect(card.emitted('signedIn')).toHaveLength(1)
  })

  it('offers a new code after the channel dies', async () => {
    vi.useFakeTimers()
    const card = mountCard(async (url: string) => {
      if (url === '/api/session/qr') return creation()
      throw Object.assign(new Error('401'), { data: { title: 'Sign-in code expired or unknown' } })
    })
    await card.find('button').trigger('click')
    await flushPromises()

    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()
    expect(card.find('svg').exists()).toBe(false)
    expect(card.text()).toContain('The code expired')
    expect(card.text()).toContain('New code')
  })

  it('says so when the channel cannot be created', async () => {
    const card = mountCard(async () => {
      throw Object.assign(new Error('429'), { data: { title: 'Too many requests' } })
    })
    await card.find('button').trigger('click')
    await flushPromises()
    expect(card.text()).toContain('Too many requests')
  })
})
