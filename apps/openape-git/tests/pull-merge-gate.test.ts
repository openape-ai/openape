// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import PullMergeGate from '../app/components/PullMergeGate.vue'

const button = defineComponent({ props: ['disabled', 'loading'], emits: ['click'], setup: (p, { slots, emit }) => () => h('button', { disabled: p.disabled || p.loading, onClick: () => emit('click') }, slots.default?.()) })
const render = (extra = {}) => mount(PullMergeGate, { props: { gate: null, mergeable: true, conflicts: [], canMerge: true, busy: false, ...extra }, global: { stubs: { UButton: button, UIcon: true } } })
describe('pull request merge feedback', () => {
  it.each(['missing', 'pending', 'failure'])('shows the blocking %s check and no merge action', (state) => {
    const wrapper = render({ gate: { blockers: [`ci: ${state}`] }, canMerge: false })
    expect(wrapper.text()).toContain(`Required checks: ci: ${state}`)
    expect(wrapper.find('button').exists()).toBe(false)
  })
  it('shows conflicts and disables the merge action', () => {
    const wrapper = render({ mergeable: false, conflicts: ['app.ts'] })
    expect(wrapper.text()).toContain('app.ts')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })
  it('emits a merge only through the enabled reviewed action', async () => {
    const wrapper = render()
    expect(wrapper.text()).toContain('This branch merges cleanly.')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('merge')).toHaveLength(1)
    await wrapper.setProps({ busy: true })
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })
})
