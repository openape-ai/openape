import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import OpenApeReportLink from '../../src/runtime/components/OpenApeReportLink.vue'

it('keeps reporting hidden until rollout, then opens the selected product without a referrer', async () => {
  const wrapper = mount(OpenApeReportLink, { props: { product: 'plans' }, attachTo: document.body })
  try {
    expect(wrapper.find('a').exists()).toBe(false)
    await wrapper.setProps({ enabled: true })
    const link = wrapper.get('a')
    expect(link.text()).toBe('Report a problem')
    expect(link.attributes()).toMatchObject({ href: 'https://repos.openape.ai/report?product=plans', target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' })
    const element = link.element as HTMLAnchorElement
    element.focus()
    expect(document.activeElement).toBe(element)
    expect(element.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    await wrapper.setProps({ product: 'tasks&token=private' })
    const destination = new URL(link.attributes('href'))
    expect([...destination.searchParams.keys()]).toEqual(['product'])
    expect(destination.searchParams.get('product')).toBe('tasks&token=private')
    await wrapper.setProps({ enabled: false })
    expect(wrapper.find('a').exists()).toBe(false)
  }
  finally { wrapper.unmount() }
})
