// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import OfferWizard from '../app/components/OfferWizard.vue'

const global = {
  stubs: {
    UButton: {
      props: ['disabled'],
      inheritAttrs: false,
      setup(_, { slots, attrs }) {
        return () => h('button', attrs, slots.default?.())
      },
    },
    UInput: { props: ['modelValue'], render() { return h('input') } },
    USelect: { props: ['modelValue', 'items'], render() { return h('select') } },
    UTextarea: { props: ['modelValue'], render() { return h('textarea') } },
    UFormField: { props: ['label'], render() { return h('label', this.$slots.default?.()) } },
  },
}

const products = [{ id: 'p1', name: 'Support', standard_price_cents: 49000, standard_billing: 'monatlich' }]

describe('offerWizard', () => {
  it('walks to Versand and emits send', async () => {
    const wrapper = mount(OfferWizard, {
      props: {
        open: true,
        firma: 'Kepler',
        person: 'Julia',
        adresse: 'Wien',
        empfaenger: 'julia@keplerlabs.io',
        products,
        graphConnected: true,
      },
      global,
    })
    expect(wrapper.text()).toContain('Kundendaten')
    await wrapper.find('[data-next]').trigger('click')
    await wrapper.find('[data-next]').trigger('click')
    await wrapper.find('[data-next]').trigger('click')
    expect(wrapper.text()).toContain('Versand')
    await wrapper.find('[data-send]').trigger('click')
    expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ to: 'julia@keplerlabs.io' })
    expect(wrapper.text()).toContain('Signatur')
  })
})
