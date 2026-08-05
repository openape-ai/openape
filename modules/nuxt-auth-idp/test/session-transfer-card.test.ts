// The card's job is to turn one click into something the other browser can
// consume — a link to paste and a code to scan — and to say so when it can't.

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SessionTransfer from '../src/runtime/components/SessionTransfer.vue'

// Nuxt UI components are auto-imported in an app; stubbed here to plain
// elements so the assertions read what a user sees, not the design system.
const global = {
  stubs: {
    UCard: { template: '<div><slot name="header" /><slot /></div>' },
    UButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
    UAlert: { props: ['title'], template: '<div>{{ title }}</div>' },
    UInput: { props: ['modelValue'], template: '<input :value="modelValue">' },
  },
}

const URL = `http://id.test/api/session/transfer/${'a'.repeat(64)}`

function mountCard(fetchImpl: () => Promise<unknown>) {
  vi.stubGlobal('$fetch', fetchImpl)
  return mount(SessionTransfer, { global })
}

describe('session transfer card', () => {
  it('offers nothing to copy until a link is created', () => {
    const card = mountCard(async () => ({ url: URL }))
    expect(card.find('input').exists()).toBe(false)
    expect(card.text()).toContain('Create sign-in link')
  })

  it('shows the link and a scannable code', async () => {
    const card = mountCard(async () => ({ url: URL }))
    await card.find('button').trigger('click')
    await card.vm.$nextTick()

    expect(card.find('input').attributes('value')).toBe(URL)
    expect(card.find('svg').exists()).toBe(true)
    expect(card.text()).toContain('Works once, within 60 seconds.')
  })

  it('says so when the link cannot be created', async () => {
    // $fetch rejects with an h3 error carrying the problem body under `data`.
    const card = mountCard(async () => {
      throw Object.assign(new Error('401'), { data: { title: 'Not authenticated' } })
    })
    await card.find('button').trigger('click')
    await card.vm.$nextTick()

    expect(card.text()).toContain('Not authenticated')
    expect(card.find('input').exists()).toBe(false)
  })
})
