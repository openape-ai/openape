import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PodKnowledge from '../../src/renderer/PodKnowledge.vue'
import type { PodDetails } from '../../src/contracts/details'

const podId = '00000000-0000-4000-8000-000000000001'
const citation = { id: 'source', version: '1', hash: 'a'.repeat(64), locator: 'fixture:order' }
const state: PodDetails = { claims: [{ id: 'current', matter: 'Order', kind: 'finding', text: '<img src=x onerror=alert(1)> is untrusted evidence', citations: [citation], revision: 2, current: true, supersedes: 'old' }, { id: 'old', matter: 'Order', kind: 'finding', text: 'An earlier deadline', citations: [citation], revision: 1, current: false, supersedes: null }, { id: 'gap', matter: 'Attachment', kind: 'gap', text: 'Unsupported attachment', citations: [citation], revision: 2, current: true, supersedes: null }], total: 3, counts: { finding: 1, gap: 1, question: 0 }, checkpointRevision: 2, versions: [], source: null }
describe('knowledge and version views', () => {
  it('separates history and gaps, expands exact sources and renders hostile text literally', async () => {
    const details = vi.fn().mockImplementation(async command => ({ ...structuredClone(state), source: command.type === 'source' ? { citation, content: 'Source content <script>unsafe()</script>' } : null }))
    window.pods = { chats: async () => ({ conversations: [], activeConversationId: null }), workflows: async () => ({ workflows: [], runs: [] }), packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding: async () => ({ connections: [], complete: true, defaultOwner: null, runtime: { ready: true, error: null } }), master: async () => ({ connected: false, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }), details } as unknown as typeof window.pods
    const wrapper = mount(PodKnowledge, { props: { podId } }); await flushPromises()
    expect(wrapper.findAll('.knowledge-entry')).toHaveLength(2); expect(wrapper.find('img').exists()).toBe(false)
    await wrapper.get('input[type="checkbox"]').setValue(true); expect(wrapper.findAll('.knowledge-entry')).toHaveLength(3)
    await wrapper.get('select').setValue('gap'); expect(wrapper.findAll('.knowledge-entry')).toHaveLength(1)
    await wrapper.get('details button').trigger('click'); await flushPromises()
    expect(details).toHaveBeenLastCalledWith({ type: 'source', podId, id: 'source', version: '1' })
    expect(wrapper.get('pre').text()).toContain('<script>unsafe()</script>'); expect(wrapper.find('script').exists()).toBe(false)
    wrapper.unmount()
  })
  it('follows an extracted quotation to its retained original and labels truncated previews', async () => {
    const original = { ...citation, id: 'raw', locator: 'fixture:original' }
    const details = vi.fn().mockImplementation(async command => ({ ...structuredClone(state), source: command.type === 'source' ? command.id === 'source' ? { citation, content: 'Extracted text', original } : { citation: original, content: 'Retained raw source', truncated: true } : null }))
    window.pods = { chats: async () => ({ conversations: [], activeConversationId: null }), workflows: async () => ({ workflows: [], runs: [] }), packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding: async () => ({ connections: [], complete: true, defaultOwner: null, runtime: { ready: true, error: null } }), master: async () => ({ connected: false, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }), details } as unknown as typeof window.pods
    const wrapper = mount(PodKnowledge, { props: { podId } }); await flushPromises()
    await wrapper.findAll('details button')[0]!.trigger('click'); await flushPromises()
    await wrapper.get('.source-content button.text-button').trigger('click'); await flushPromises()
    expect(details).toHaveBeenLastCalledWith({ type: 'source', podId, id: 'raw', version: '1' })
    expect(wrapper.get('pre').text()).toBe('Retained raw source')
    expect(wrapper.text()).toContain('Preview truncated')
    wrapper.unmount()
  })
})
