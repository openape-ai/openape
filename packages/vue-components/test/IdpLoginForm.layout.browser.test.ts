import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import IdpLoginForm from '../src/components/IdpLoginForm.vue'

/**
 * Real-browser value proof: these assertions need an actual layout engine.
 * happy-dom does no layout — getBoundingClientRect() returns all zeros and
 * checkVisibility() does not exist — so this file only runs via
 * `pnpm run test:browser` (Playwright Chromium).
 */
describe('idpLoginForm layout (real browser)', () => {
  it('lays out email input and submit button with real geometry', () => {
    const wrapper = mount(IdpLoginForm, { attachTo: document.body })
    const input = wrapper.get('input#idp-email').element as HTMLInputElement
    const button = wrapper.get('button[type=submit]').element as HTMLButtonElement

    const inputRect = input.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()

    expect(inputRect.width).toBeGreaterThan(0)
    expect(inputRect.height).toBeGreaterThan(0)
    expect(button.checkVisibility()).toBe(true)
    // Block layout: the submit button renders below the email field.
    expect(buttonRect.top).toBeGreaterThanOrEqual(inputRect.bottom)

    wrapper.unmount()
  })

  it('keeps the error banner out of the layout until an error is set', async () => {
    const wrapper = mount(IdpLoginForm, { attachTo: document.body })

    expect(wrapper.find('form > div.rounded-md').exists()).toBe(false)
    const formTopWithoutError = wrapper.get('input#idp-email').element.getBoundingClientRect().top

    // Trigger a failing login so the v-if banner enters the layout.
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify({ title: 'Unknown user' }), { status: 400 })
    try {
      await wrapper.get('input#idp-email').setValue('ape@example.com')
      await wrapper.get('form').trigger('submit')
      await new Promise(resolve => setTimeout(resolve, 0))
      await wrapper.vm.$nextTick()

      const banner = wrapper.get('form > div.rounded-md').element as HTMLElement
      expect(banner.checkVisibility()).toBe(true)
      expect(banner.getBoundingClientRect().height).toBeGreaterThan(0)
      // The banner physically pushes the email field down.
      const formTopWithError = wrapper.get('input#idp-email').element.getBoundingClientRect().top
      expect(formTopWithError).toBeGreaterThan(formTopWithoutError)
    }
    finally {
      globalThis.fetch = originalFetch
      wrapper.unmount()
    }
  })
})
