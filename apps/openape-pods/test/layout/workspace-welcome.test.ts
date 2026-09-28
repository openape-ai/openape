import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import WorkspaceWelcome from '../../../openape-pods-relay/app/components/WorkspaceWelcome.vue'
import { screenshotPath } from './evidence'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); document.documentElement.style.colorScheme = '' })
it('keeps workspace sign-in readable at desktop and phone widths in both system themes', async () => {
  wrapper = mount(WorkspaceWelcome, { attachTo: document.body })
  for (const [width, theme] of [[1440, 'light'], [390, 'light'], [390, 'dark']] as const) {
    document.documentElement.style.colorScheme = theme
    await page.viewport(width, width < 760 ? 1500 : 1000)
    await flushPromises()
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    if (width < 760) expect(wrapper.get('button').element.getBoundingClientRect().bottom).toBeLessThan(850)
    expect(wrapper.get('input').element.getBoundingClientRect().width).toBeGreaterThan(240)
    expect(wrapper.get('button').element.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: screenshotPath(`pods-welcome-${width}-${theme}.png`), fullPage: true })
  }
  wrapper.unmount()
  wrapper = mount(WorkspaceWelcome, { attachTo: document.body, props: { loginFailed: true } })
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('Sign-in could not be completed')
  await page.screenshot({ path: screenshotPath('pods-welcome-login-error.png'), fullPage: true })
})
