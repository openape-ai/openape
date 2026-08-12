// The account-hub card for kiosks signed in via QR: invisible when there
// are none, and "End session" must actually revoke the row it belongs to.

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QrSessions from '../src/runtime/components/QrSessions.vue'

const global = {
  stubs: {
    UCard: { template: '<div><slot name="header" /><slot /></div>' },
    // No re-emit: the native click already reaches the parent via
    // fallthrough attrs; a stub-side $emit would double every call.
    UButton: { props: ['label'], template: '<button>{{ label }}</button>' },
    UAlert: { props: ['title'], template: '<div>{{ title }}</div>' },
  },
}

const SESSION = {
  id: 'a'.repeat(64),
  userId: 'human@example.com',
  requester: { ip: '203.0.113.7', userAgent: 'KioskBrowser/1.0' },
  createdAt: Date.now(),
  expiresAt: Date.now() + 3_600_000,
}

function mountCard(fetchImpl: (url: string, opts?: any) => Promise<unknown>) {
  vi.stubGlobal('$fetch', fetchImpl)
  return mount(QrSessions, { global })
}

afterEach(() => vi.unstubAllGlobals())

describe('qr sessions card', () => {
  it('renders nothing when no kiosk is signed in', async () => {
    const card = mountCard(async () => [])
    await flushPromises()
    expect(card.text()).toBe('')
  })

  it('lists the kiosk and revokes it on request', async () => {
    const deleted: string[] = []
    const card = mountCard(async (url: string, opts?: any) => {
      if (opts?.method === 'DELETE') {
        deleted.push(url)
        return { ok: true }
      }
      return [SESSION]
    })
    await flushPromises()

    expect(card.text()).toContain('KioskBrowser/1.0')
    expect(card.text()).toContain('203.0.113.7')

    await card.find('button').trigger('click')
    await flushPromises()

    expect(deleted).toEqual([`/api/session/qr/sessions/${SESSION.id}`])
    expect(card.text()).toBe('')
  })
})
