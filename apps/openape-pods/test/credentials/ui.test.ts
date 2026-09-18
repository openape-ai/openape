import { randomUUID } from 'node:crypto'
import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PodResources from '../../src/renderer/PodResources.vue'
import PodScript from '../../src/renderer/PodScript.vue'
import ScriptAccess from '../../src/renderer/ScriptAccess.vue'
import type { ScriptView } from '../../src/contracts/scripts'

it('saves only a masked pod-scoped value and clears it even when saving fails', async () => {
  const pod = { id: randomUUID(), name: 'One', revision: 1, lifecycle: 'paused', activeScript: null }
  const resources = vi.fn().mockResolvedValue({ resources: [], epoch: 4 })
  window.pods = { workspace: async () => ({ pods: [pod] }), resources } as unknown as typeof window.pods
  const wrapper = mount(PodResources, { props: { selectedPodId: pod.id, mode: 'values' }, global: { stubs: { ScriptAccess: true } } }); await flushPromises()
  await wrapper.get('[name="credential-alias"]').setValue('crm'); await wrapper.get('[name="credential-value"]').setValue('synthetic-only')
  expect(wrapper.get('[name="credential-value"]').attributes('type')).toBe('password')
  resources.mockRejectedValueOnce(new Error('Pod or resources changed; reload before assigning credentials'))
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(resources).toHaveBeenLastCalledWith({ type: 'saveCredential', podId: pod.id, alias: 'crm', value: 'synthetic-only', epoch: 4 })
  expect((wrapper.get('[name="credential-value"]').element as HTMLInputElement).value).toBe('')
  expect(wrapper.get('[role="alert"]').text()).toContain('reload')
  wrapper.unmount()
})
it('directs missing secrets to their assignments without source-bound reapproval', async () => {
  const hash = 'a'.repeat(64)
  const view: ScriptView = { resourceEpoch: 1, credentialAliases: ['crm'], pod: { id: randomUUID(), name: 'One', revision: 1, lifecycle: 'paused', activeScript: null }, drafts: [], versions: [], source: { kind: 'version', id: hash, hash, assignmentRevision: 1, revision: 0, code: 'export async function run() {}', capabilities: ['credential.crm'], validated: true, evidence: '{}', credentialAccessApproved: false } }
  const scripts = vi.fn().mockImplementation(async (command) => { if (command.type === 'approveCredentials') view.source!.credentialAccessApproved = true; if (command.type === 'activate') view.pod.activeScript = hash; return structuredClone(view) }); const runs = vi.fn().mockResolvedValue({ runs: [] })
  window.pods = { scripts, runs, resources: async () => ({ resources: [], epoch: 1 }) } as unknown as typeof window.pods
  const wrapper = mount(PodScript, { props: { pod: view.pod } }); await flushPromises()
  const button = (name: string) => wrapper.findAll('button').find(item => item.text() === name)!
  await button('Run').trigger('click'); await flushPromises()
  expect(runs).not.toHaveBeenCalled(); expect(scripts.mock.calls.some(([call]) => call.type === 'activate')).toBe(false)
  await wrapper.findAll('button').find(item => item.text() === 'Manage variables and secrets')!.trigger('click'); await flushPromises()
  expect(wrapper.emitted('values')).toHaveLength(1)
  expect(scripts.mock.calls.some(([call]) => call.type === 'approveCredentials')).toBe(false)
  expect(runs).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('keeps a revoked but selected alias visible so its declaration can be removed', async () => {
  const view: ScriptView = { resourceEpoch: 2, credentialAliases: [], pod: { id: randomUUID(), name: 'One', revision: 1, lifecycle: 'paused', activeScript: null }, drafts: [], versions: [], source: { kind: 'draft', id: randomUUID(), hash: null, assignmentRevision: 1, revision: 1, code: 'export async function run() {}', capabilities: ['credential.old-secret'], validated: false, evidence: null, credentialAccessApproved: false } }
  window.pods = { scripts: vi.fn().mockResolvedValue(view), resources: async () => ({ resources: [], epoch: 2 }) } as unknown as typeof window.pods
  const wrapper = mount(ScriptAccess, { props: { podId: view.pod.id, kind: 'secrets' } }); await flushPromises()
  expect(wrapper.text()).toContain('old-secret')
  await wrapper.get('input[type="checkbox"]').setValue(false)
  await wrapper.findAll('button').find(button => button.text() === 'Save script access')!.trigger('click'); await flushPromises()
  expect(window.pods.scripts).toHaveBeenCalledWith(expect.objectContaining({ type: 'save', capabilities: [] })); wrapper.unmount()
})

it('lists a required missing secret and prefills its alias without assigning access', async () => {
  const pod = { id: randomUUID(), name: 'One' }
  const resources = vi.fn().mockResolvedValue({ resources: [], epoch: 0 })
  window.pods = { workspace: async () => ({ pods: [pod] }), resources } as unknown as typeof window.pods
  const wrapper = mount(PodResources, { props: { selectedPodId: pod.id, mode: 'values', requiredAliases: ['notification_token'] }, global: { stubs: { ScriptAccess: true } } }); await flushPromises()
  expect(wrapper.get('.resource-row').text()).toContain('notification_token')
  expect(wrapper.get('.resource-row').text()).toContain('Not set')
  await wrapper.get('.resource-row button').trigger('click')
  expect(wrapper.get<HTMLInputElement>('[name="credential-alias"]').element.value).toBe('notification_token')
  expect(wrapper.get<HTMLInputElement>('[name="credential-value"]').element.value).toBe('')
  expect(resources).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})
