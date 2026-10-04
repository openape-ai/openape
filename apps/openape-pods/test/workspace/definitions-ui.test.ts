import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import type { DefinitionsView } from '../../src/contracts/definitions'
import PodDefinition from '../../src/renderer/PodDefinition.vue'
import { applyLanguage } from '../../src/renderer/i18n'

const podId = '00000000-0000-4000-8000-000000000001'
const definitionId = '00000000-0000-4000-8000-000000000002'
const groupId = '00000000-0000-4000-8000-000000000003'
const draftId = '00000000-0000-4000-8000-000000000004'
const props = { pod: { id: podId, name: 'Source', revision: 1, lifecycle: 'paused' as const, activeScript: 'a'.repeat(64) } }
function fixture() {
  const before = { version: 1, state: 'published' as const, contentHash: 'a'.repeat(64), lockHash: 'b'.repeat(64), contract: null, capabilities: [], packages: { dependencies: {} }, defaults: {} }
  const after = { ...before, version: 2, contentHash: 'c'.repeat(64), capabilities: ['mail.read'], defaults: { label: 'Public value' } }
  const view: DefinitionsView = { definitions: [{ id: definitionId, name: 'Reusable', versions: [before, after] }], instances: [{ podId, definitionId, version: 1, bindingRevision: 1, groupId, diverged: false }], provisioning: [] }
  const definitions = vi.fn().mockImplementation(async command => ({ ...structuredClone(view), ...['previewUpdate', 'prepareUpdate'].includes(command.type) ? { update: { podId, before, after, beforeCode: 'old source', afterCode: 'new source', changed: ['code', 'rights', 'defaults'], ...(command.type === 'prepareUpdate' ? { draftId } : {}) } } : {} }))
  const scripts = vi.fn().mockResolvedValue({ pod: props.pod, source: { id: draftId, revision: 1, validated: true } })
  window.pods = { definitions, scripts, workspace: async () => ({ pods: [props.pod], organization: { revision: 1, groups: [{ id: groupId, name: 'Company A', collapsed: false, podIds: [podId] }] } }) } as unknown as typeof window.pods
  return { view, definitions, scripts }
}
afterEach(() => { applyLanguage('en') })
async function opened() {
  const wrapper = mount(PodDefinition, { props })
  wrapper.get('details').element.open = true
  await wrapper.get('details').trigger('toggle'); await flushPromises()
  return wrapper
}
it('requires a visible diff and an independent validation before switching one instance', async () => {
  const f = fixture(); const wrapper = await opened()
  const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
  expect(wrapper.text()).toContain('mail.read')
  await button('Review update for this instance').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('Before'); expect(wrapper.text()).toContain('After'); expect(wrapper.text()).toContain('Public value')
  expect(button('Use version for this instance').attributes('disabled')).toBeDefined()
  await button('Prepare and validate version').trigger('click'); await flushPromises()
  expect(f.scripts).toHaveBeenCalledWith({ type: 'validate', podId, revision: 1, draftId, draftRevision: 1 })
  expect(f.definitions).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'activateUpdate' }))
  await button('Use version for this instance').trigger('click'); await flushPromises()
  expect(f.definitions).toHaveBeenCalledWith({ type: 'activateUpdate', podId, draftId, expectedBinding: 1 })
  expect(wrapper.get('[role="status"]').text()).toContain('remain paused')
  wrapper.unmount()
})
it('keeps the same creation request after failure and offers an explicit identity retry', async () => {
  const f = fixture(); const wrapper = await opened()
  f.definitions.mockImplementation(async (command) => {
    if (command.type === 'instantiate') {
      f.view.instances.push({ podId: draftId, definitionId, version: 2, bindingRevision: 1, groupId, diverged: true })
      f.view.provisioning = [{ requestId: command.requestId, podId: draftId, state: 'failed', error: 'Synthetic identity unavailable' }]
      throw new Error('Synthetic identity unavailable')
    }
    return structuredClone(f.view)
  })
  const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
  await wrapper.findAll('select')[1]!.setValue(groupId)
  await button('Create separate instance').trigger('click'); await flushPromises()
  const first = f.definitions.mock.calls.find(([command]) => command.type === 'instantiate')![0]
  expect(wrapper.get('[role="alert"]').text()).toContain('Synthetic identity unavailable')
  expect(button('Create separate instance').attributes('disabled')).toBeDefined()
  expect(f.definitions.mock.calls.filter(([command]) => command.type === 'instantiate').map(([command]) => command.requestId)).toEqual([first.requestId])
  await button('Retry existing instance').trigger('click'); await flushPromises()
  expect(f.definitions).toHaveBeenCalledWith({ type: 'retryProvision', requestId: first.requestId })
  applyLanguage('de'); await flushPromises(); expect(wrapper.text()).toContain('Wiederverwendbare Definition')
  wrapper.unmount()
})

it('explains unavailable definition editing without offering actions that will fail', async () => {
  const f = fixture(); f.view.unavailableReason = 'Definition editing is not available for this connected workspace yet.'
  const wrapper = await opened()
  expect(wrapper.get('[role="status"]').text()).toContain('not available')
  expect(wrapper.find('fieldset').exists()).toBe(false)
  wrapper.unmount()
})

it('prepares the existing paused instance with explicit defaults without publishing reuse', async () => {
  const f = fixture()
  f.view.definitions[0]!.versions = [{ ...f.view.definitions[0]!.versions[0]!, state: 'legacy', defaults: { mode: 'preview' } }]
  const wrapper = await opened()
  expect(wrapper.get('textarea').element.value).toContain('preview')
  const button = wrapper.findAll('button').find(item => item.text() === 'Prepare this existing instance')!
  await button.trigger('click'); await flushPromises()
  expect(f.definitions).toHaveBeenCalledWith({ type: 'prepareLocal', podId, expectedScript: props.pod.activeScript, name: 'Reusable', defaults: { mode: 'preview' } })
  expect(wrapper.get('[role="status"]').text()).toContain('own identity and permissions')
  expect(wrapper.text()).not.toContain('Create separate instance')
  wrapper.unmount()
})
