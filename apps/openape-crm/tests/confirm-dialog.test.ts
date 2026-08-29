// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import ConfirmDialog from '../app/components/ConfirmDialog.vue'

// Nuxt UI is global in the app; reduced to plain elements here so the
// assertions read the visible text rather than the design system.
const global = {
  stubs: {
    UModal: { props: ['open'], render(this: { open: boolean, $slots: Record<string, () => unknown> }) {
      return this.open ? h('div', this.$slots.content?.()) : null
    } },
    UButton: { render(this: { $slots: Record<string, () => unknown> }) {
      return h('button', this.$slots.default?.())
    } },
  },
}

const props = {
  open: true,
  title: 'Deal löschen?',
  consequence: '„Website-Relaunch" wird samt 2 Notizen entfernt.',
}

describe('confirmDialog', () => {
  it('names the object and the consequence', () => {
    const wrapper = mount(ConfirmDialog, { props, global })
    expect(wrapper.text()).toContain('Deal löschen?')
    expect(wrapper.text()).toContain('samt 2 Notizen')
  })

  it('renders nothing while closed', () => {
    const wrapper = mount(ConfirmDialog, { props: { ...props, open: false }, global })
    expect(wrapper.text()).toBe('')
  })

  it('confirms only through the confirm button', async () => {
    const wrapper = mount(ConfirmDialog, { props, global })
    const [cancel, confirm] = wrapper.findAll('button')

    await cancel!.trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:open')![0]).toEqual([false])

    await confirm!.trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('uses a caller-supplied label for the confirm button', () => {
    const wrapper = mount(ConfirmDialog, { props: { ...props, confirmLabel: 'Endgültig entfernen' }, global })
    expect(wrapper.text()).toContain('Endgültig entfernen')
  })
})
