import type { Slots } from 'vue'
import type { HtmlReportView } from '../../shared/html-view'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HtmlReport from '../../app/components/HtmlReport.vue'
import PlanSourceEditor from '../../app/components/PlanSourceEditor.vue'

const report: HtmlReportView = { document_id: 'report', publication_id: 'version', version: 1, latest_version: 2, title: 'A report with deliberately long words for a narrow viewport', category: 'Test Runs', language: 'en', tags: ['reports', 'consolidation'], metadata: { 'verification.stage': 'production acceptance' }, author: 'owner@example.com', created_at: 1, artifact_digest: 'a'.repeat(64), policy_version: 'publisher-trusted-html/2', external_images: ['https://images.example.test/example.png'], external_links: ['https://example.test/evidence'], audience: 'private', expires_at: null, access_revision: 1, retention_revision: 1, caller_role: 'owner', url: '/d/report', version_url: '/d/report?v=1', legacy_plan_id: null }
const global = { stubs: { NuxtLink: { setup: (_: unknown, { slots }: { slots: Slots }) => () => h('a', slots.default?.()) } } }
let wrapper: ReturnType<typeof mount>
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })
describe('HTML document controls', () => {
  it('requires an explicit opening action and preserves the sandbox on the narrow layout', async () => {
    const fetch = vi.fn().mockResolvedValue({ url: 'about:blank' }); vi.stubGlobal('$fetch', fetch)
    wrapper = mount(HtmlReport, { props: { report }, global, attachTo: document.body }); await flushPromises()
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('publisher-controlled HTML')
    expect(wrapper.text()).toContain('external image reference')
    const open = wrapper.findAll('button').find(button => button.text() === 'Open active document')!
    await open.trigger('click'); await flushPromises()
    expect(fetch).toHaveBeenCalledWith('/api/documents/report/viewer', { method: 'POST', query: { revision: 1 } })
    expect(wrapper.get('iframe').attributes()).toMatchObject({ sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', src: 'about:blank' })
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    const label = wrapper.get('dt').element.getBoundingClientRect()
    const value = wrapper.get('dd').element.getBoundingClientRect()
    expect(value.top).toBeGreaterThanOrEqual(label.bottom)
  })
  it('shows a denied viewer without inserting any document HTML', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('revoked')))
    wrapper = mount(HtmlReport, { props: { report }, global }); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Open active document')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('access changed')
    expect(wrapper.find('iframe').exists()).toBe(false)
  })
  it('retains source and the originally read version after a conflicting save', async () => {
    const fetch = vi.fn().mockRejectedValue({ statusCode: 409 }); vi.stubGlobal('$fetch', fetch)
    wrapper = mount(PlanSourceEditor, { props: { plan: { id: 'plan', title: 'Before', body_md: '# Original', status: 'draft', version: 3, caller_role: 'editor' } }, global, attachTo: document.body })
    await wrapper.get('textarea').setValue('# My unsaved draft'); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(fetch).toHaveBeenCalledWith('/api/plans-compat/plans/plan', { method: 'PATCH', body: { title: 'Before', body_md: '# My unsaved draft', status: 'draft', expected_version: 3 } })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('# My unsaved draft')
    expect(wrapper.get('[role=alert]').text()).toContain('Your draft is still here')
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  })
})
