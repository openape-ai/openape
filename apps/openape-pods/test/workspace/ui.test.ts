import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PodKnowledge from '../../src/renderer/PodKnowledge.vue'
import PodVersions from '../../src/renderer/PodVersions.vue'
import type { PodDetails } from '../../src/contracts/details'

const podId = '00000000-0000-4000-8000-000000000001'
const citation = { id: 'source', version: '1', hash: 'a'.repeat(64), locator: 'fixture:order' }
const state: PodDetails = { claims: [{ id: 'current', matter: 'Order', kind: 'finding', text: '<img src=x onerror=alert(1)> is untrusted evidence', citations: [citation], revision: 2, current: true, supersedes: 'old' }, { id: 'old', matter: 'Order', kind: 'finding', text: 'An earlier deadline', citations: [citation], revision: 1, current: false, supersedes: null }, { id: 'gap', matter: 'Attachment', kind: 'gap', text: 'Unsupported attachment', citations: [citation], revision: 2, current: true, supersedes: null }], total: 3, counts: { finding: 1, gap: 1, question: 0 }, checkpointRevision: 2, versions: [], source: null }
describe('knowledge and version views', () => {
  it('separates history and gaps, expands exact sources and renders hostile text literally', async () => {
    const details = vi.fn().mockImplementation(async command => ({ ...structuredClone(state), source: command.type === 'source' ? { citation, content: 'Source content <script>unsafe()</script>' } : null }))
    window.pods = { details } as unknown as typeof window.pods
    const wrapper = mount(PodKnowledge, { props: { podId } }); await flushPromises()
    expect(wrapper.findAll('.knowledge-entry')).toHaveLength(2); expect(wrapper.find('img').exists()).toBe(false)
    await wrapper.get('input[type="checkbox"]').setValue(true); expect(wrapper.findAll('.knowledge-entry')).toHaveLength(3)
    await wrapper.get('select').setValue('gap'); expect(wrapper.findAll('.knowledge-entry')).toHaveLength(1)
    await wrapper.get('details button').trigger('click'); await flushPromises()
    expect(details).toHaveBeenLastCalledWith({ type: 'source', podId, id: 'source', version: '1' })
    expect(wrapper.get('pre').text()).toContain('<script>unsafe()</script>'); expect(wrapper.find('script').exists()).toBe(false)
    wrapper.unmount()
  })
  it('only offers validated retained versions and surfaces stale activation errors', async () => {
    const details = vi.fn().mockResolvedValueOnce({ ...state, versions: [{ hash: 'a'.repeat(64), assignmentRevision: 1, active: true, validated: true }, { hash: 'b'.repeat(64), assignmentRevision: 1, active: false, validated: false }, { hash: 'c'.repeat(64), assignmentRevision: 1, active: false, validated: true }] }).mockRejectedValueOnce(new Error('Active version changed'))
    window.pods = { details } as unknown as typeof window.pods
    const wrapper = mount(PodVersions, { props: { pod: { id: podId, name: 'Orders', assignment: 'Read', revision: 1, lifecycle: 'paused', activeScript: 'a'.repeat(64) } } }); await flushPromises()
    expect(wrapper.findAll('button').map(button => button.attributes('disabled') !== undefined)).toEqual([true, true, false])
    await wrapper.findAll('button')[2]!.trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Active version changed')
    expect(wrapper.emitted('changed')).toBeUndefined(); wrapper.unmount()
  })
})
