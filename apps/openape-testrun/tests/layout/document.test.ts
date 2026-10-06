import { h } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import DocumentReport from '../../app/components/DocumentReport.vue'

let wrapper: ReturnType<typeof mount>
afterEach(() => wrapper?.unmount())
it('keeps edition titles escaped, series navigation visible and the frame constrained', async () => {
  wrapper = mount(DocumentReport, { props: { report: { type: 'document', title: 'Escaped series', category: '<img src=x>', language: 'de', version: 1, documentUrl: 'about:blank', artifactDigest: 'a'.repeat(64), created_by: 'owner@example.com', created_by_act: 'agent', created_at: 1, visibility: 'private', editions: [{ id: '1', slug: 'first', title: '<script>unsafe</script>', version: 1 }, { id: '2', slug: 'second', title: 'Second edition', version: 2 }] } }, global: { stubs: { NuxtLink: { props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) } } }, attachTo: document.body })
  expect(wrapper.text()).toContain('<script>unsafe</script>')
  expect(wrapper.findAll('script, img')).toHaveLength(0)
  expect(wrapper.get('iframe').attributes('sandbox')).toBe('')
  await wrapper.get('summary').trigger('click')
  expect(wrapper.text()).toContain('Second edition')
  expect(wrapper.get('iframe').element.getBoundingClientRect().width).toBeLessThanOrEqual(innerWidth)
})
