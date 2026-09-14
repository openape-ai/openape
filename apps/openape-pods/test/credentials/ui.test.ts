import { randomUUID } from 'node:crypto'
import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PodResources from '../../src/renderer/PodResources.vue'
import PodScript from '../../src/renderer/PodScript.vue'
import type { ScriptView } from '../../src/contracts/scripts'

it('saves only a masked pod-scoped value and clears it even when saving fails', async () => {
  const pod = { id: randomUUID(), name: 'One', revision: 1, lifecycle: 'paused', assignment: 'Read', activeScript: null }
  const resources = vi.fn().mockResolvedValue({ resources: [], epoch: 4 })
  window.pods = { workspace: async () => ({ pods: [pod] }), resources } as unknown as typeof window.pods
  const wrapper = mount(PodResources, { props: { selectedPodId: pod.id } }); await flushPromises()
  await wrapper.get('[name="credential-alias"]').setValue('crm'); await wrapper.get('[name="credential-value"]').setValue('synthetic-only')
  expect(wrapper.get('[name="credential-value"]').attributes('type')).toBe('password')
  resources.mockRejectedValueOnce(new Error('Pod or resources changed; reload before assigning credentials'))
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(resources).toHaveBeenLastCalledWith({ type: 'saveCredential', podId: pod.id, alias: 'crm', value: 'synthetic-only', epoch: 4 })
  expect((wrapper.get('[name="credential-value"]').element as HTMLInputElement).value).toBe('')
  expect(wrapper.get('[role="alert"]').text()).toContain('reload')
  wrapper.unmount()
})
it('preserves credential declarations and requires reviewed source before activating', async () => {
  const hash = 'a'.repeat(64)
  const view: ScriptView = { resourceEpoch: 1, credentialAliases: ['crm'], pod: { id: randomUUID(), name: 'One', revision: 1, assignment: 'Read', lifecycle: 'paused', activeScript: null }, drafts: [], versions: [{ hash, assignmentRevision: 1, active: false, validated: true }], source: { kind: 'version', id: hash, hash, assignmentRevision: 1, revision: 0, code: 'export async function run() {}', capabilities: ['credential.crm'], validated: true, evidence: '{}', credentialAccessApproved: false } }
  const scripts = vi.fn().mockResolvedValue(structuredClone(view)); window.pods = { scripts } as unknown as typeof window.pods
  const wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  const button = (name: string) => wrapper.findAll('button').find(item => item.text() === name)!
  expect(button('Activate for next run').attributes('disabled')).toBeDefined()
  await button('Review credential access').trigger('click'); await flushPromises()
  expect(scripts).toHaveBeenLastCalledWith({ type: 'approveCredentials', podId: view.pod.id, revision: 1, hash, epoch: 1 })
  expect(button('Activate for next run').attributes('disabled')).toBeDefined()
  view.source!.credentialAccessApproved = true; scripts.mockResolvedValueOnce(structuredClone(view))
  await button('Review credential access').trigger('click'); await flushPromises()
  expect(button('Activate for next run').attributes('disabled')).toBeUndefined()
  view.resourceEpoch = 2; scripts.mockResolvedValueOnce(structuredClone(view))
  await button('Refresh history').trigger('click'); await flushPromises()
  expect(button('Activate for next run').attributes('disabled')).toBeDefined()
  expect(wrapper.text()).not.toContain('Credential access approved for this version and current resources.')
  await button('Edit as draft').trigger('click'); await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(false)
  expect(wrapper.text()).toContain('Unsaved changes'); expect(button('Activate for next run').attributes('disabled')).toBeDefined()
  await button('Save draft').trigger('click'); await flushPromises()
  expect(scripts.mock.calls.at(-1)![0].capabilities).toEqual([])
  wrapper.unmount()
})
