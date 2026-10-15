import { page } from 'vitest/browser'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import ReportUnavailable from '../../app/components/ReportUnavailable.vue'
import { routeBoundary, screenshotPath } from './harness'

let wrapper: ReturnType<typeof mount>
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })

it.each([401, 404, 410])('keeps the %i recovery actions inside a narrow screen', async (status) => {
  vi.stubGlobal('useOpenApeAuth', () => ({ user: ref({ sub: 'reader@example.test' }), fetchUser: vi.fn() }))
  wrapper = mount(ReportUnavailable, { props: { status, returnTo: '/r/private?v=2' }, global: routeBoundary, attachTo: document.body })
  expect(wrapper.get('.empty h2').text()).toBe(status === 401 ? 'Sign in to read this report' : 'This report isn\'t available')
  const actions = wrapper.findAll('.acts a')
  expect(actions.map(action => action.attributes('href'))).toEqual(status === 401
    ? ['/?returnTo=%2Fr%2Fprivate%3Fv%3D2']
    : ['/reports', '/reports/removed'])
  for (const action of actions) {
    const bounds = action.element.getBoundingClientRect()
    expect(bounds.height).toBe(36)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(innerWidth)
  }
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
  if (status === 401 || status === 410) await page.screenshot({ path: screenshotPath(`unavailable-${status}-narrow`) })
})
