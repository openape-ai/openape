import { randomUUID } from 'node:crypto'
import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PodResources from '../../src/renderer/PodResources.vue'
import PodScript from '../../src/renderer/PodScript.vue'
import type { ScriptView } from '../../src/contracts/scripts'

it('saves only a masked pod-scoped value and clears it even when saving fails', async () => {
  const pod = { id: randomUUID(), name: 'One', revision: 1, lifecycle: 'paused', activeScript: null }
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
it('runs a validated script without a legacy secret approval prompt', async () => {
  const hash = 'a'.repeat(64)
  const view: ScriptView = { resourceEpoch: 1, credentialAliases: ['crm'], pod: { id: randomUUID(), name: 'One', revision: 1, lifecycle: 'paused', activeScript: null }, drafts: [], versions: [], source: { kind: 'version', id: hash, hash, assignmentRevision: 1, revision: 0, code: 'export async function run() {}', capabilities: ['credential.crm'], validated: true, evidence: '{}', credentialAccessApproved: false } }
  const scripts = vi.fn().mockImplementation(async (command) => { if (command.type === 'approveCredentials') view.source!.credentialAccessApproved = true; if (command.type === 'activate') view.pod.activeScript = hash; return structuredClone(view) }); const runs = vi.fn().mockResolvedValue({ runs: [] })
  window.pods = { scripts, runs, resources: async () => ({ resources: [], epoch: 1 }) } as unknown as typeof window.pods
  const wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  const button = (name: string) => wrapper.findAll('button').find(item => item.text() === name)!
  await button('Run').trigger('click'); await flushPromises()
  expect(runs).toHaveBeenCalledWith({ type: 'start', podId: view.pod.id, expectedScript: hash })
  expect(scripts.mock.calls.some(([call]) => call.type === 'approveCredentials')).toBe(false)
  expect(wrapper.text()).not.toContain('Assign the required secrets')
  wrapper.unmount()
})
it('shows assigned secrets without script access checkboxes or a save-access button', async () => {
  const podId = randomUUID()
  window.pods = { workspace: async () => ({ pods: [{ id: podId, name: 'One' }] }), resources: async () => ({ resources: [{ id: randomUUID(), kind: 'credential', name: 'crm', state: 'ready', configuration: { alias: 'crm' } }], epoch: 2 }) } as unknown as typeof window.pods
  const wrapper = mount(PodResources, { props: { selectedPodId: podId, mode: 'values' } }); await flushPromises()
  expect(wrapper.text()).toContain('crm')
  expect(wrapper.text()).not.toContain('Secrets used by the script')
  expect(wrapper.text()).not.toContain('Save script access')
  expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  wrapper.unmount()
})

it('lists a required missing secret and prefills its alias without assigning access', async () => {
  const pod = { id: randomUUID(), name: 'One' }
  const resources = vi.fn().mockResolvedValue({ resources: [], epoch: 0 })
  window.pods = { workspace: async () => ({ pods: [pod] }), resources } as unknown as typeof window.pods
  const wrapper = mount(PodResources, { props: { selectedPodId: pod.id, mode: 'values', requiredAliases: ['notification_token'] } }); await flushPromises()
  expect(wrapper.get('.resource-row').text()).toContain('notification_token')
  expect(wrapper.get('.resource-row').text()).toContain('Not set')
  await wrapper.get('.resource-row button').trigger('click')
  expect(wrapper.get<HTMLInputElement>('[name="credential-alias"]').element.value).toBe('notification_token')
  expect(wrapper.get<HTMLInputElement>('[name="credential-value"]').element.value).toBe('')
  expect(resources).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})
