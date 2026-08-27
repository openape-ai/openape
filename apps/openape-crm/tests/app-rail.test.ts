// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import AppRail from '../app/components/AppRail.vue'

const global = {
  stubs: {
    NuxtLink: {
      props: ['to', 'title'],
      render(this: { to: string, title: string, $slots: { default: () => unknown } }) {
        return h('a', { href: this.to, title: this.title }, this.$slots.default?.())
      },
    },
    UIcon: { render: () => h('i') },
  },
}

describe('appRail', () => {
  it('shows the five pane titles', () => {
    const wrapper = mount(AppRail, { props: { pane: 'vorgaenge' }, global })
    const titles = wrapper.findAll('a').map(a => a.attributes('title'))
    expect(titles).toEqual(['Vorgänge', 'Aufgaben', 'Support', 'Kontakte', 'Katalog'])
  })

  it('shows a support unread marker when unread is set', () => {
    const withDot = mount(AppRail, { props: { pane: 'support', unread: 2 }, global })
    expect(withDot.find('.rounded-full').exists()).toBe(true)
    const without = mount(AppRail, { props: { pane: 'support', unread: 0 }, global })
    expect(without.find('.rounded-full').exists()).toBe(false)
  })
})
