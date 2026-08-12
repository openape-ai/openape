// The phone-side approve page: it must show WHO is asking before the human
// decides — that context plus the warning is the only QRLjacking defense —
// and it must bounce signed-out phones through the passkey login first.

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LinkPage from '../src/runtime/pages/link.vue'
import { __resetNuxtImportsMocks, __setNavigateTo, __setRouteQuery } from './mocks/nuxt-imports'

const global = {
  stubs: {
    UCard: { template: '<div><slot name="header" /><slot /></div>' },
    // No re-emit: the native click already reaches the parent via
    // fallthrough attrs; a stub-side $emit would double every call.
    UButton: {
      props: ['label', 'loading', 'disabled'],
      template: '<button>{{ label }}</button>',
    },
    UAlert: {
      props: ['title', 'description'],
      template: '<div>{{ title }} {{ description }}</div>',
    },
    UIcon: { template: '<i />' },
  },
}

const CHANNEL = 'a'.repeat(64)
const CONTEXT = {
  state: 'pending',
  requester: { ip: '203.0.113.7', userAgent: 'KioskBrowser/1.0' },
  expiresAt: Date.now() + 120_000,
}

function mountPage(fetchImpl: (url: string, opts?: any) => Promise<unknown>) {
  vi.stubGlobal('$fetch', fetchImpl)
  return mount(LinkPage, { global })
}

beforeEach(() => {
  __resetNuxtImportsMocks()
  __setRouteQuery({ c: CHANNEL })
})

describe('qr approve page', () => {
  it('shows the requester before asking for a decision', async () => {
    const page = mountPage(async () => CONTEXT)
    await flushPromises()

    expect(page.text()).toContain('203.0.113.7')
    expect(page.text()).toContain('KioskBrowser/1.0')
    expect(page.text()).toContain('Only approve if this code is on a screen directly in front of you.')
    expect(page.text()).toContain('Approve')
    expect(page.text()).toContain('Deny')
  })

  it('sends a signed-out phone through the passkey login and back', async () => {
    const navigations: unknown[] = []
    __setNavigateTo(async (to: unknown) => { navigations.push(to) })
    const page = mountPage(async () => {
      throw Object.assign(new Error('401'), { statusCode: 401 })
    })
    await flushPromises()

    expect(navigations).toEqual([`/login?returnTo=${encodeURIComponent(`/link?c=${CHANNEL}`)}`])
    expect(page.findAll('button')).toHaveLength(0)
  })

  it('approves and reports the one-hour lifetime', async () => {
    const calls: string[] = []
    const page = mountPage(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        calls.push(url)
        return { ok: true }
      }
      return CONTEXT
    })
    await flushPromises()
    const approve = page.findAll('button').find(b => b.text() === 'Approve')!
    await approve.trigger('click')
    await flushPromises()

    expect(calls).toEqual([`/api/session/qr/${CHANNEL}/approve`])
    expect(page.text()).toContain('The other browser is now signed in as you.')
    expect(page.text()).toContain('one hour')
  })

  it('denies without signing anything in', async () => {
    const calls: string[] = []
    const page = mountPage(async (url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        calls.push(url)
        return { ok: true }
      }
      return CONTEXT
    })
    await flushPromises()
    const deny = page.findAll('button').find(b => b.text() === 'Deny')!
    await deny.trigger('click')
    await flushPromises()

    expect(calls).toEqual([`/api/session/qr/${CHANNEL}/deny`])
    expect(page.text()).toContain('Sign-in request denied.')
  })

  it('says so when the code is dead or the link is incomplete', async () => {
    const page = mountPage(async () => {
      throw Object.assign(new Error('404'), {
        statusCode: 404,
        data: { title: 'Sign-in code expired or unknown' },
      })
    })
    await flushPromises()
    expect(page.text()).toContain('Sign-in code expired or unknown')

    __setRouteQuery({})
    const bare = mountPage(async () => CONTEXT)
    await flushPromises()
    expect(bare.text()).toContain('This link is missing its sign-in code.')
  })
})
