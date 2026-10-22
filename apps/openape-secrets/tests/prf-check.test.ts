// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PrfCheck from '../app/components/PrfCheck.vue'

const check = vi.hoisted(() => vi.fn())
vi.mock('../app/utils/prf-check', () => ({ checkPrf: check }))
describe('interactive PRF diagnostic', () => {
  it('waits for an explicit click and displays only the result', async () => {
    check.mockResolvedValue({ status: 'passed', stablePrf: true })
    const wrapper = mount(PrfCheck)
    expect(check).not.toHaveBeenCalled()
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('passed')
    wrapper.unmount()
  })
  it('reports incompatibility without enabling a fallback', async () => {
    check.mockRejectedValue(new Error('PRF unsupported'))
    const wrapper = mount(PrfCheck)
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('PRF unsupported')
    wrapper.unmount()
  })
})
