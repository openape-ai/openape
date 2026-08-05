import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import OpenApeAuth from '../../src/runtime/components/OpenApeAuth.vue'
import { loading, user } from './nuxt-imports'

// A phone viewport (390px) is set in vitest.browser.config.ts, and setup.ts
// leaves the document bare on purpose — see the note there. Everything measured
// below therefore comes from the component's own <style> block, which is the
// only styling the widget gets on a host page it does not control.

// The card sizes itself off its parent, so each test states the room it gets.
let host: HTMLElement

function openInAHostOfWidth(width: string) {
  host = document.createElement('div')
  host.style.width = width
  document.body.append(host)
  return mount(OpenApeAuth, { attachTo: host })
}

const box = (el: Element) => el.getBoundingClientRect()

beforeEach(() => {
  loading.value = false
  user.value = null
})

afterEach(() => {
  host.remove()
})

describe('login card on a phone', () => {
  it('fits the screen it is embedded in', () => {
    const wrapper = openInAHostOfWidth('100%')

    const card = wrapper.find('.openape-auth').element as HTMLElement
    const input = wrapper.find('.openape-auth-input').element as HTMLElement

    // Guard against measuring an empty card: the form must really be there.
    expect(input.offsetWidth).toBeGreaterThan(0)
    expect(wrapper.find('.openape-auth-button').exists()).toBe(true)

    expect(card.offsetWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    // The full-width input stays inside the card's 2rem padding instead of
    // pushing through its border.
    expect(box(input).right).toBeLessThanOrEqual(box(card).right - 32)

    wrapper.unmount()
  })

  it('stops growing at 400px in a wide host', () => {
    const wrapper = openInAHostOfWidth('900px')

    const card = wrapper.find('.openape-auth').element as HTMLElement

    expect((wrapper.find('.openape-auth-input').element as HTMLElement).offsetWidth).toBeGreaterThan(0)
    expect(card.offsetWidth).toBe(400)

    wrapper.unmount()
  })

  it('stacks the form in one column with a 12px gap', () => {
    const wrapper = openInAHostOfWidth('100%')

    const form = wrapper.find('.openape-auth-form').element as HTMLElement
    const input = wrapper.find('.openape-auth-input').element as HTMLElement
    const button = wrapper.find('.openape-auth-button').element as HTMLElement

    expect(input.offsetWidth).toBeGreaterThan(0)
    expect(button.offsetWidth).toBeGreaterThan(0)
    // One column: the button sits below the input, .75rem clear of it.
    expect(box(button).top - box(input).bottom).toBe(12)
    expect(input.offsetWidth).toBe(form.clientWidth)

    wrapper.unmount()
  })
})

describe('login card while the session is still unknown', () => {
  it('holds a 200px stage and centres the spinner in it', () => {
    loading.value = true
    const wrapper = openInAHostOfWidth('100%')

    const card = wrapper.find('.openape-auth--loading').element as HTMLElement
    const spinner = wrapper.find('.openape-auth-spinner').element as HTMLElement

    // Guard: an absent spinner would centre perfectly and prove nothing.
    // It is a 24px disc, drawn a little larger because it adds its ring on the
    // outside — unlike the card and the input it declares no `box-sizing`, so
    // on a host page without a preflight the ring is not paid for from within.
    expect(box(spinner).width).toBe(box(spinner).height)
    expect(box(spinner).width).toBeGreaterThanOrEqual(24)
    expect(box(spinner).width).toBeLessThan(30)

    // Without the reserved height the page jumps when the form arrives.
    expect(card.offsetHeight).toBeGreaterThanOrEqual(200)
    const offCentre = (box(spinner).left + box(spinner).right) / 2 - (box(card).left + box(card).right) / 2
    expect(Math.abs(offCentre)).toBeLessThan(1)

    wrapper.unmount()
  })
})
