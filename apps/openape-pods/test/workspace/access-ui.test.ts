import { randomUUID } from 'node:crypto'
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import ScriptAccess from '../../src/renderer/ScriptAccess.vue'
import { scriptBuffer } from '../../src/renderer/script-buffer'
import type { ScriptView } from '../../src/contracts/scripts'

function fixture() {
  const podId = randomUUID()
  const view: ScriptView = { pod: { id: podId, name: 'One', revision: 1, lifecycle: 'paused', activeScript: null }, source: { kind: 'draft', id: randomUUID(), code: 'export async function run() {}', capabilities: ['tool.orders.invoke'], revision: 1, assignmentRevision: 1, hash: null, validated: false, credentialAccessApproved: false, evidence: null }, versions: [], drafts: [], credentialAliases: ['crm'], resourceEpoch: 1 }
  const scripts = vi.fn().mockResolvedValue(view)
  window.pods = { scripts, resources: async () => ({ epoch: 1, resources: [{ kind: 'credential', name: 'crm', state: 'ready', configuration: {} }, { kind: 'tool', name: 'Orders', state: 'ready', configuration: { capability: 'tool.orders.invoke' } }] }) } as unknown as typeof window.pods
  return { podId, view, scripts }
}
it('saves secret declarations with the current code and preserves program declarations', async () => {
  const f = fixture(); const wrapper = mount(ScriptAccess, { props: { podId: f.podId, kind: 'secrets' } }); await flushPromises()
  expect(wrapper.findAll('input')).toHaveLength(1)
  await wrapper.get('input').setValue(true); await wrapper.get('button').trigger('click'); await flushPromises()
  expect(f.scripts).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'save', code: f.view.source!.code, capabilities: ['tool.orders.invoke', 'credential.crm'], draftRevision: 1 }))
  expect(f.scripts.mock.calls.every(([command]) => command.type === 'save' || command.type === 'list')).toBe(true)
  wrapper.unmount()
})
it('protects unsaved editor text from a settings-side script save', async () => {
  const f = fixture(); const buffer = scriptBuffer(f.podId); buffer.editing = true; buffer.code = 'unsaved editor changes'
  const wrapper = mount(ScriptAccess, { props: { podId: f.podId, kind: 'secrets' } }); await flushPromises()
  await wrapper.get('input').setValue(true); await wrapper.get('button').trigger('click'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toBe('Save your script editor changes first')
  expect(f.scripts).toHaveBeenCalledTimes(1); expect(buffer.code).toBe('unsaved editor changes')
  wrapper.unmount()
})
it('shows stale-save errors without overwriting the current script', async () => {
  const f = fixture(); const wrapper = mount(ScriptAccess, { props: { podId: f.podId, kind: 'tools' } }); await flushPromises()
  expect(wrapper.text()).toContain('Orders'); expect(wrapper.text()).not.toContain('crm')
  f.scripts.mockRejectedValueOnce(new Error('Stale draft revision'))
  await wrapper.get('input').setValue(false); await wrapper.get('button').trigger('click'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('Stale draft revision')
  expect(wrapper.find('[role="status"]').exists()).toBe(false)
  wrapper.unmount()
})
