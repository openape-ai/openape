// @vitest-environment happy-dom
import type { Deal } from '../app/utils/board'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import DealCard from '../app/components/DealCard.vue'

// Nuxt UI ist in der App global auto-importiert; hier als schlichtes Element
// gestubbt, damit die Assertions den sichtbaren Text lesen, nicht das Design-System.
const global = {
  stubs: {
    USelect: { props: ['modelValue'], render: () => h('select') },
  },
}

function deal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: 'd1',
    title: 'Neue Website',
    value_cents: 500000,
    stage: 'lead',
    position: 0,
    contact_id: null,
    contact_name: null,
    org_id: null,
    org_name: null,
    created_at: 0,
    closed_at: null,
    ...overrides,
  }
}

describe('dealCard', () => {
  it('shows the title and the value in euros', () => {
    const wrapper = mount(DealCard, { props: { deal: deal() }, global })
    expect(wrapper.text()).toContain('Neue Website')
    expect(wrapper.text()).toContain('5.000')
  })

  it('joins contact and organization into one subtitle', () => {
    const wrapper = mount(DealCard, {
      props: { deal: deal({ contact_name: 'Max Muster', org_name: 'Muster GmbH' }) },
      global,
    })
    expect(wrapper.text()).toContain('Max Muster · Muster GmbH')
  })

  it('leaves out the subtitle when neither is set', () => {
    const wrapper = mount(DealCard, { props: { deal: deal() }, global })
    expect(wrapper.text()).not.toContain('·')
  })

  it('shows the closing date only for a closed deal', () => {
    const open = mount(DealCard, { props: { deal: deal() }, global })
    expect(open.text()).not.toContain('Abgeschlossen')

    const closed = mount(DealCard, {
      props: { deal: deal({ stage: 'won', closed_at: Date.UTC(2026, 7, 17, 12) }) },
      global,
    })
    expect(closed.text()).toContain('Abgeschlossen am 17.8.2026')
  })

  it('emits open when the card body is clicked', async () => {
    const wrapper = mount(DealCard, { props: { deal: deal() }, global })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })
})
