import { randomUUID } from 'node:crypto'
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PodResources from '../../src/renderer/PodResources.vue'
import PodScript from '../../src/renderer/PodScript.vue'
import { scriptBuffer } from '../../src/renderer/script-buffer'
import type { ScriptView } from '../../src/contracts/scripts'

function fixture() {
  const podId = randomUUID()
  const view: ScriptView = { pod: { id: podId, name: 'One', revision: 1, lifecycle: 'paused', activeScript: null }, source: { kind: 'draft', id: randomUUID(), code: 'export async function run() {}', capabilities: ['tool.orders.invoke', 'credential.legacy'], revision: 1, assignmentRevision: 1, hash: null, validated: false, credentialAccessApproved: false, evidence: null }, versions: [], drafts: [], credentialAliases: ['crm'], resourceEpoch: 1 }
  const scripts = vi.fn().mockResolvedValue(view)
  window.pods = { scripts, workspace: async () => ({ pods: [view.pod] }), resources: async () => ({ epoch: 1, resources: [{ kind: 'credential', name: 'crm', state: 'ready', configuration: {} }, { kind: 'tool', name: 'Orders', state: 'ready', configuration: { capability: 'tool.orders.invoke' } }] }) } as unknown as typeof window.pods
  return { podId, view, scripts }
}
it('saves source without secret declarations and preserves program declarations', async () => {
  const f = fixture(); const wrapper = mount(PodScript, { props: { pod: f.view.pod } }); await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'Save script')!.trigger('click'); await flushPromises()
  expect(() => structuredClone(f.scripts.mock.calls.at(-1)![0])).not.toThrow()
  expect(f.scripts).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'save', code: f.view.source!.code, capabilities: ['tool.orders.invoke'], draftRevision: 1 }))
  expect(f.scripts.mock.calls.every(([command]) => command.type === 'save' || command.type === 'list')).toBe(true)
  wrapper.unmount()
})
it('leaves unsaved editor text untouched when opening secret assignments', async () => {
  const f = fixture(); const buffer = scriptBuffer(f.podId); buffer.editing = true; buffer.code = 'unsaved editor changes'
  const wrapper = mount(PodResources, { props: { selectedPodId: f.podId, mode: 'values' } }); await flushPromises()
  expect(wrapper.text()).toContain('crm'); expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  expect(f.scripts).not.toHaveBeenCalled(); expect(buffer.code).toBe('unsaved editor changes')
  wrapper.unmount()
})
it('shows stale-save errors without overwriting the current script', async () => {
  const f = fixture(); const wrapper = mount(PodScript, { props: { pod: f.view.pod } }); await flushPromises()
  f.scripts.mockRejectedValueOnce(new Error('Stale draft revision'))
  await wrapper.findAll('button').find(button => button.text() === 'Save script')!.trigger('click'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('Stale draft revision')
  expect(scriptBuffer(f.podId).code).toBe(f.view.source!.code)
  wrapper.unmount()
})
