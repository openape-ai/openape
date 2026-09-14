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
  const wrapper = mount(PodResources, { props: { selectedPodId: pod.id, mode: 'values' } }); await flushPromises()
  await wrapper.get('[name="credential-alias"]').setValue('crm'); await wrapper.get('[name="credential-value"]').setValue('synthetic-only')
  expect(wrapper.get('[name="credential-value"]').attributes('type')).toBe('password')
  resources.mockRejectedValueOnce(new Error('Pod or resources changed; reload before assigning credentials'))
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(resources).toHaveBeenLastCalledWith({ type: 'saveCredential', podId: pod.id, alias: 'crm', value: 'synthetic-only', epoch: 4 })
  expect((wrapper.get('[name="credential-value"]').element as HTMLInputElement).value).toBe('')
  expect(wrapper.get('[role="alert"]').text()).toContain('reload')
  wrapper.unmount()
})
it('requires owner credential review before Run and preserves declarations when saving', async () => {
  const hash = 'a'.repeat(64)
  const view: ScriptView = { resourceEpoch: 1, credentialAliases: ['crm'], pod: { id: randomUUID(), name: 'One', revision: 1, assignment: 'Read', lifecycle: 'paused', activeScript: null }, drafts: [], versions: [], source: { kind: 'version', id: hash, hash, assignmentRevision: 1, revision: 0, code: 'export async function run() {}', capabilities: ['credential.crm'], validated: true, evidence: '{}', credentialAccessApproved: false } }
  const scripts = vi.fn().mockImplementation(async (command) => { if (command.type === 'approveCredentials') view.source!.credentialAccessApproved = true; if (command.type === 'activate') view.pod.activeScript = hash; return structuredClone(view) }); const runs = vi.fn().mockResolvedValue({ runs: [] })
  window.pods = { scripts, runs, resources: async () => ({ resources: [], epoch: 1 }) } as unknown as typeof window.pods
  const wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  const button = (name: string) => wrapper.findAll('button').find(item => item.text() === name)!
  await button('Run').trigger('click'); await flushPromises()
  expect(runs).not.toHaveBeenCalled(); expect(scripts.mock.calls.some(([call]) => call.type === 'activate')).toBe(false)
  await button('Review credential access').trigger('click'); await flushPromises()
  expect(scripts).toHaveBeenCalledWith({ type: 'approveCredentials', podId: view.pod.id, revision: 1, hash, epoch: 1 })
  expect(runs).toHaveBeenCalledWith({ type: 'start', podId: view.pod.id, expectedScript: hash })
  await wrapper.get('input[type="checkbox"]').setValue(false)
  expect(wrapper.text()).toContain('Unsaved changes')
  await button('Save script').trigger('click'); await flushPromises()
  expect(scripts.mock.calls.at(-1)![0].capabilities).toEqual([]); wrapper.unmount()
})
it('keeps a revoked but selected alias visible so its declaration can be removed', async () => {
  const view: ScriptView = { resourceEpoch: 2, credentialAliases: [], pod: { id: randomUUID(), name: 'One', revision: 1, assignment: 'Read', lifecycle: 'paused', activeScript: null }, drafts: [], versions: [], source: { kind: 'draft', id: randomUUID(), hash: null, assignmentRevision: 1, revision: 1, code: 'export async function run() {}', capabilities: ['credential.old-secret'], validated: false, evidence: null, credentialAccessApproved: false } }
  window.pods = { scripts: vi.fn().mockResolvedValue(view), resources: async () => ({ resources: [], epoch: 2 }) } as unknown as typeof window.pods
  const wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  expect(wrapper.text()).toContain('Not assigned')
  await wrapper.get('input[type="checkbox"]').setValue(false)
  await wrapper.findAll('button').find(button => button.text() === 'Save script')!.trigger('click'); await flushPromises()
  expect(window.pods.scripts).toHaveBeenCalledWith(expect.objectContaining({ type: 'save', capabilities: [] })); wrapper.unmount()
})
