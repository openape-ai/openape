// @vitest-environment happy-dom
import type { PipelineStage } from '../shared/stages'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import StageHeader from '../app/components/StageHeader.vue'

const global = {
  stubs: {
    UInput: {
      props: ['modelValue'],
      emits: ['update:modelValue'],
      render(this: { modelValue: string, $emit: (e: string, v: string) => void }) {
        return h('input', {
          value: this.modelValue,
          onInput: (event: Event) => this.$emit('update:modelValue', (event.target as HTMLInputElement).value),
        })
      },
    },
    UDropdownMenu: { render: () => h('div') },
    UIcon: { render: () => h('i') },
  },
}

const stage: PipelineStage = { key: 'proposal', name: 'Angebot', outcome: 'open', position: 2 }
const props = { stage, count: 3, total: '€ 3.200', stageCount: 5, editable: true }

async function startRename(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('button').trigger('click')
  return wrapper.find('input')
}

describe('stageHeader', () => {
  it('shows name, count and total', () => {
    const wrapper = mount(StageHeader, { props, global })
    expect(wrapper.text()).toContain('Angebot')
    expect(wrapper.text()).toContain('3')
    expect(wrapper.text()).toContain('€ 3.200')
  })

  it('renames on enter', async () => {
    const wrapper = mount(StageHeader, { props, global })
    const input = await startRename(wrapper)
    await input.setValue('Angebot draußen')
    await input.trigger('keydown.enter')
    expect(wrapper.emitted('rename')).toEqual([['Angebot draußen']])
  })

  // Enter blendet das Feld aus und feuert dabei `blur` — ohne Sperre liefe das
  // Umbenennen zweimal und der Nutzer sähe zwei Bestätigungen.
  it('renames once, even though enter also triggers blur', async () => {
    const wrapper = mount(StageHeader, { props, global })
    const input = await startRename(wrapper)
    await input.setValue('Angebot draußen')
    await input.trigger('keydown.enter')
    await input.trigger('blur')
    expect(wrapper.emitted('rename')).toHaveLength(1)
  })

  it('drops the edit on escape', async () => {
    const wrapper = mount(StageHeader, { props, global })
    const input = await startRename(wrapper)
    await input.setValue('Weg damit')
    await input.trigger('keydown.esc')
    expect(wrapper.emitted('rename')).toBeUndefined()
  })

  it('stays read-only without the right to edit', async () => {
    const wrapper = mount(StageHeader, { props: { ...props, editable: false }, global })
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('input').exists()).toBe(false)
  })
})
