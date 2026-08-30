// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PipelineTrack from '../app/components/PipelineTrack.vue'

describe('pipelineTrack', () => {
  it('renders eight deal stages and marks the current, done, and endmarker', () => {
    const wrapper = mount(PipelineTrack, { props: { phase: 'deal', stufe: 'demo' } })
    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(8)
    expect(buttons[2]!.text()).toContain('Demo durchgeführt')
    expect(buttons[2]!.classes()).toContain('on')
    expect(buttons[0]!.classes()).toContain('done')
    expect(buttons[5]!.text()).toContain('Gewonnen')
    expect(buttons[5]!.classes()).toContain('mark')
  })

  it('emits the stufe id when a stage is clicked', async () => {
    const wrapper = mount(PipelineTrack, { props: { phase: 'deal', stufe: 'demo' } })
    await wrapper.findAll('button')[3]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['followup'])
  })
})
