import { h, Suspense } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { afterEach, expect, it } from 'vitest'
import ReportPage from '../../app/pages/r/[slug].vue'
import { installNuxtGlobals } from './report-fixture'
import { routeBoundary, screenshotPath } from './harness'

let wrapper: ReturnType<typeof mount>
afterEach(() => wrapper?.unmount())
it('keeps edition titles escaped, series navigation visible and the frame constrained', async () => {
  installNuxtGlobals({ type: 'document', title: 'Escaped series', category: '<img src=x>', language: 'de', version: 1, documentUrl: 'about:blank', artifactDigest: 'a'.repeat(64), created_by: 'owner@example.com', created_by_act: 'agent', created_at: 1, visibility: 'private', editions: [{ id: '1', slug: 'first', title: '<script>unsafe</script>', version: 1 }, { id: '2', slug: 'second', title: 'Second edition', version: 2 }] })
  wrapper = mount({ render: () => h(Suspense, null, { default: () => h(ReportPage) }) }, { global: routeBoundary, attachTo: document.body })
  await flushPromises()
  expect(wrapper.text()).toContain('<script>unsafe</script>')
  expect(wrapper.findAll('script, img')).toHaveLength(0)
  expect(wrapper.get('iframe').attributes('sandbox')).toBe('')
  const details = wrapper.get('details').element as HTMLDetailsElement
  expect(details.open).toBe(false)
  await page.getByText('Series editions · 2', { exact: true }).click()
  expect(details.open).toBe(true)
  expect(wrapper.text()).toContain('Second edition')
  expect(wrapper.findAll('.editions a').map(link => link.attributes('href'))).toEqual(['/r/first', '/r/second'])
  const frame = wrapper.get('iframe').element.getBoundingClientRect()
  expect(frame.width).toBeLessThanOrEqual(innerWidth)
  expect(frame.width).toBeGreaterThan(100)
  expect(frame.top).toBe(details.getBoundingClientRect().bottom)
  expect(frame.bottom).toBe(innerHeight)
  expect(frame.height).toBeGreaterThan(500)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
  await page.screenshot({ path: screenshotPath('document-series-narrow') })
})
