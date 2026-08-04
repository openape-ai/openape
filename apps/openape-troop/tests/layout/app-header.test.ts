import type { Slots } from 'vue'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import AppHeader from '../../app/components/AppHeader.vue'

// A phone viewport (390px) is set in vitest.browser.config.ts. The header brings
// its own styles; everything inside it is stubbed, so the stubs carry the widths
// the real controls have — measured in the running app (`nuxt dev`, /companies
// at 390px, dark): the view switch is 250px (six icon buttons), a solid icon
// button 36px, a ghost icon button 28px.
const SWITCH_WIDTH = 250
const ACTION_BUTTON = 36
const GHOST_BUTTON = 28

// Render functions, not string templates: the browser build of Vue ships no
// compiler, so a `template` stub renders nothing at all — and a header made of
// empty boxes passes every geometry assertion.
const global = {
  stubs: {
    // flex-shrink: 0 mirrors the real switch: six rigid buttons that keep their
    // width even when the row around them runs out of space.
    ViewToggle: { render: () => h('nav', { style: `width:${SWITCH_WIDTH}px;height:36px;flex-shrink:0` }) },
    UButton: {
      setup: (_: unknown, { slots }: { slots: Slots }) =>
        () => h('button', { style: `width:${GHOST_BUTTON}px;height:${GHOST_BUTTON}px` }, slots.default?.()),
    },
  },
}

const right = (el: Element) => el.getBoundingClientRect().right
const left = (el: Element) => el.getBoundingClientRect().left

describe('app header on a phone', () => {
  // The widest header the app has: gorilla, switch, a page action and logout —
  // what /companies and /skills show a signed-in owner.
  it('keeps a long sub-page name from pushing the actions off the screen', () => {
    const wrapper = mount(AppHeader, {
      props: { active: 'inbox', title: 'Regeln, Track-Records und alles andere, was hier stehen könnte' },
      slots: { actions: `<button style="width:${ACTION_BUTTON}px;height:${ACTION_BUTTON}px" />` },
      global,
      attachTo: document.body,
    })

    const header = wrapper.find('header').element as HTMLElement
    const nav = wrapper.find('.app-header__nav').element as HTMLElement
    const actions = wrapper.find('.app-header__actions').element as HTMLElement
    const title = wrapper.find('.app-header__title').element as HTMLElement
    const viewSwitch = nav.querySelector('nav') as HTMLElement

    // Guard against measuring an empty header: the switch must really be there.
    expect(viewSwitch.offsetWidth).toBe(SWITCH_WIDTH)

    // Below 640px the sub-page name steps back, so no title length grows the row.
    expect(title.offsetWidth).toBe(0)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth)
    // The switch stays clear of the buttons instead of sliding underneath them.
    expect(right(viewSwitch)).toBeLessThanOrEqual(left(actions))

    wrapper.unmount()
  })
})
