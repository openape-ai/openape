import { randomUUID } from 'node:crypto'
import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PodScript from '../../src/renderer/PodScript.vue'
import ScriptCode from '../../src/renderer/ScriptCode.vue'
import type { ScriptView } from '../../src/contracts/scripts'

function fixture() {
  const hash = 'a'.repeat(64)
  const view: ScriptView = { resourceEpoch: 0, credentialAliases: [], pod: { id: randomUUID(), name: 'Orders', revision: 1, lifecycle: 'paused', activeScript: hash }, versions: [{ hash, assignmentRevision: 1, validated: true, active: true }], drafts: [], source: { kind: 'version', id: hash, code: '// <img src=x onerror=alert(1)>\nexport async function run() {}', capabilities: [], revision: 0, assignmentRevision: 1, hash, validated: true, evidence: '{}', credentialAccessApproved: false } }
  const scripts = vi.fn().mockResolvedValue(structuredClone(view))
  window.pods = { packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, resources: async () => ({ resources: [], variables: [], epoch: 0 }), scripts } as unknown as typeof window.pods
  return { view, scripts }
}
it('shows highlighted literal source and preserves unsaved edits across navigation with discard protection', async () => {
  const { view, scripts } = fixture(); let wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  expect(wrapper.get('textarea').attributes('readonly')).toBeUndefined(); expect(wrapper.find('img').exists()).toBe(false); expect(wrapper.find('.keyword').exists()).toBe(true)
  await wrapper.get('textarea').setValue('export async function run() { return { edited: true } }')
  expect(wrapper.text()).toContain('Unsaved changes')
  expect(wrapper.text()).not.toContain('Activate for next run')
  wrapper.unmount(); wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  expect(wrapper.get('textarea').element.value).toContain('edited: true'); expect(scripts).toHaveBeenCalledTimes(2)
  await wrapper.findAll('button').find(button => button.text() === 'Reload script')!.trigger('click')
  expect(wrapper.get('[role="alert"]').text()).toContain('Discard unsaved edits')
  await wrapper.findAll('button').find(button => button.text() === 'Keep editing')!.trigger('click')
  expect(wrapper.get('textarea').element.value).toContain('edited: true')
  scripts.mockRejectedValueOnce(new Error('Draft changed; reload current revision'))
  await wrapper.findAll('button').find(button => button.text() === 'Save script')!.trigger('click'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('Draft changed'); expect(wrapper.get('textarea').element.value).toContain('edited: true')
  wrapper.unmount()
})
it('keeps archived scripts read-only and prevents undeclared direct execution', async () => {
  const { view } = fixture(); view.pod.lifecycle = 'archived'
  const wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  expect(wrapper.get('textarea').attributes('readonly')).toBeDefined()
  expect(wrapper.findAll('button').some(button => button.text() === 'Edit as draft')).toBe(false)
  for (const name of ['Save script', 'Run']) expect(wrapper.findAll('button').find(button => button.text() === name)!.attributes('disabled')).toBeDefined()
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

it('preserves the first unsaved script across tab navigation', async () => {
  const { view, scripts } = fixture(); view.source = null; view.versions = []; view.pod.activeScript = null; scripts.mockResolvedValue(view)
  let wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  await wrapper.get('textarea').setValue('export async function run() { /* first unsaved script */ }')
  wrapper.unmount(); wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  expect(wrapper.get('textarea').element.value).toContain('first unsaved script'); wrapper.unmount()
})
it('lets keyboard users leave the editor with Escape then Tab', async () => {
  const wrapper = mount(ScriptCode, { props: { modelValue: 'hello' } }); const input = wrapper.get('textarea')
  await input.trigger('keydown', { key: 'Escape' }); await input.trigger('keydown', { key: 'Tab' })
  expect(wrapper.emitted('update:modelValue')).toBeUndefined(); wrapper.unmount()
})

it('preserves existing application declarations when saving code without permission controls', async () => {
  const { view, scripts } = fixture()
  view.source!.capabilities = ['tool.orders.read']
  scripts.mockResolvedValue(view)
  window.pods.resources = vi.fn().mockResolvedValue({ resources: [{ id: randomUUID(), podId: view.pod.id, kind: 'tool', state: 'ready', revision: 1, name: 'Orders CLI', configuration: { capability: 'tool.orders.read' } }], variables: [], epoch: 0 })
  const wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  expect(wrapper.text()).not.toContain('Read assigned mail')
  expect(wrapper.text()).not.toContain('Orders CLI')
  await wrapper.get('textarea').setValue('export async function run() { return {} }')
  await wrapper.findAll('button').find(button => button.text() === 'Save script')!.trigger('click'); await flushPromises()
  expect(scripts).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'save', capabilities: ['tool.orders.read'] }))
  wrapper.unmount()
})

it('keeps permission editing out of the script tab', async () => {
  const { view } = fixture()
  view.source!.capabilities = ['credential.notification_token']
  const wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  expect(wrapper.text()).not.toContain('Required access')
  expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  wrapper.unmount()
})

it('adds and removes listed packages, preserving unsaved selections across navigation without installation', async () => {
  const { view, scripts } = fixture()
  window.pods.packages = vi.fn().mockResolvedValue([{ name: 'dayjs', version: '1.11.13', description: 'Date library' }])
  let wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  await wrapper.get('[aria-label="Add dependency"]').trigger('click')
  await wrapper.get('.package-search input').setValue('https://www.npmjs.com/package/dayjs')
  await wrapper.get('.package-search').trigger('submit'); await flushPromises()
  expect(window.pods.packages).toHaveBeenCalledWith({ query: 'https://www.npmjs.com/package/dayjs' })
  await wrapper.get('.package-result').trigger('click')
  await wrapper.get('.package-choice input').setValue('^1.11.13')
  await wrapper.get('.package-choice button').trigger('click')
  expect(wrapper.get('[role="alert"]').text()).toContain('exact versions')
  await wrapper.get('.package-choice input').setValue('1.11.13')
  await wrapper.get('.package-choice button').trigger('click')
  expect(wrapper.get('.package-row').text()).toContain('dayjs'); expect(wrapper.text()).toContain('Unsaved changes')
  wrapper.unmount(); wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  expect(wrapper.get('.package-row').text()).toContain('1.11.13')
  await wrapper.findAll('button').find(button => button.text() === 'Save script')!.trigger('click'); await flushPromises()
  expect(scripts).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'save', packages: { dependencies: { dayjs: '1.11.13' } } }))
  expect(scripts.mock.calls.some(([command]) => command.type === 'prepareDependencies')).toBe(false)
  wrapper.unmount()
})
it('removes the selected dependency and shows npm errors without discarding the script', async () => {
  const { view, scripts } = fixture(); view.source!.packages = { dependencies: { dayjs: '1.11.13' } }; scripts.mockResolvedValue(view)
  window.pods.packages = vi.fn().mockRejectedValue(new Error('npm search failed. Check the package name and connection, then try again.'))
  const wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  await wrapper.get('.package-row').trigger('click'); await wrapper.get('[aria-label="Remove dependency"]').trigger('click')
  expect(wrapper.text()).toContain('No dependencies added.')
  await wrapper.get('[aria-label="Add dependency"]').trigger('click'); await wrapper.get('.package-search input').setValue('dates')
  await wrapper.get('.package-search').trigger('submit'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('npm search failed')
  expect(wrapper.get('textarea').element.value).toContain('export async function run')
  await wrapper.findAll('button').find(button => button.text() === 'Save script')!.trigger('click'); await flushPromises()
  expect(scripts).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'save', packages: { dependencies: {} } }))
  wrapper.unmount()
})
