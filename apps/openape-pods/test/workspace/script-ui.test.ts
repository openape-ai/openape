import { randomUUID } from 'node:crypto'
import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PodScript from '../../src/renderer/PodScript.vue'
import ScriptCode from '../../src/renderer/ScriptCode.vue'
import type { ScriptView } from '../../src/contracts/scripts'

function fixture() {
  const hash = 'a'.repeat(64)
  const view: ScriptView = { pod: { id: randomUUID(), name: 'Orders', assignment: 'Read', revision: 1, lifecycle: 'paused', activeScript: hash }, versions: [{ hash, assignmentRevision: 1, validated: true, active: true }], drafts: [], source: { kind: 'version', id: hash, code: '// <img src=x onerror=alert(1)>\nexport async function run() {}', capabilities: [], revision: 0, assignmentRevision: 1, hash, validated: true, evidence: '{}' } }
  const scripts = vi.fn().mockResolvedValue(structuredClone(view))
  window.pods = { scripts } as unknown as typeof window.pods
  return { view, scripts }
}
it('shows literal immutable source and preserves unsaved edits across navigation with discard protection', async () => {
  const { view, scripts } = fixture(); let wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  expect(wrapper.get('textarea').attributes('readonly')).toBeDefined(); expect(wrapper.find('img').exists()).toBe(false)
  await wrapper.findAll('button').find(button => button.text() === 'Edit as draft')!.trigger('click')
  await wrapper.get('textarea').setValue('export async function run() { return { edited: true } }')
  expect(wrapper.text()).toContain('Unsaved changes')
  expect(wrapper.findAll('button').find(button => button.text() === 'Activate for next run')!.attributes('disabled')).toBeDefined()
  wrapper.unmount(); wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  expect(wrapper.get('textarea').element.value).toContain('edited: true'); expect(scripts).toHaveBeenCalledTimes(1)
  await wrapper.findAll('button').find(button => button.text() === 'New script')!.trigger('click')
  expect(wrapper.get('[role="alert"]').text()).toContain('Discard unsaved edits')
  await wrapper.findAll('button').find(button => button.text() === 'Keep editing')!.trigger('click')
  expect(wrapper.get('textarea').element.value).toContain('edited: true')
  scripts.mockRejectedValueOnce(new Error('Draft changed; reload current revision'))
  await wrapper.findAll('button').find(button => button.text() === 'Save draft')!.trigger('click'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('Draft changed'); expect(wrapper.get('textarea').element.value).toContain('edited: true')
  wrapper.unmount()
})
it('keeps archived scripts read-only and prevents undeclared direct execution', async () => {
  const { view } = fixture(); view.pod.lifecycle = 'archived'
  const wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  expect(wrapper.get('textarea').attributes('readonly')).toBeDefined()
  expect(wrapper.findAll('button').some(button => button.text() === 'Edit as draft')).toBe(false)
  for (const name of ['Save draft', 'Validate draft', 'Activate for next run']) expect(wrapper.findAll('button').find(button => button.text() === name)!.attributes('disabled')).toBeDefined()
  wrapper.unmount()
})
it('supports indentation and the save shortcut without executing editor text', async () => {
  const wrapper = mount(ScriptCode, { props: { modelValue: 'hello' } }); const input = wrapper.get('textarea')
  input.element.setSelectionRange(0, 0); await input.trigger('keydown', { key: 'Tab' })
  expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['  hello'])
  await input.trigger('keydown', { key: 'Tab', shiftKey: true }); expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  await input.trigger('keydown', { key: 's', metaKey: true }); expect(wrapper.emitted('save')).toHaveLength(1)
  wrapper.unmount()
})
