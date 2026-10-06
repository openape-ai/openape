import type { Slots } from 'vue'
import type { HtmlReportView } from '../../shared/html-view'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HtmlReport from '../../app/components/HtmlReport.vue'

const report: HtmlReportView = { document_id: 'report', publication_id: 'version', version: 1, latest_version: 2, title: 'A report with deliberately long words for a narrow viewport', category: 'Test Runs', language: 'en', tags: ['reports', 'consolidation'], metadata: { 'verification.stage': 'production acceptance' }, author: 'owner@example.com', created_at: 1, artifact_digest: 'a'.repeat(64), policy_version: 'publisher-trusted-html/2', external_images: ['https://images.example.test/example.png'], external_links: ['https://example.test/evidence'], audience: 'private', team_id: null, expires_at: null, access_revision: 1, retention_revision: 1, caller_role: 'owner', url: '/d/report', version_url: '/d/report?v=1', legacy_plan_id: null }
const global = { stubs: { NuxtLink: { setup: (_: unknown, { slots }: { slots: Slots }) => () => h('a', slots.default?.()) } } }
let wrapper: ReturnType<typeof mount>
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })
describe('HTML document reading view', () => {
  it('opens active HTML only after the explicit trust decision, with the unchanged sandbox', async () => {
    const fetch = vi.fn().mockResolvedValue({ url: 'about:blank' }); vi.stubGlobal('$fetch', fetch)
    wrapper = mount(HtmlReport, { props: { report }, global, attachTo: document.body }); await flushPromises()
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('Open this report?')
    expect(wrapper.text()).toContain('It can\'t use your OpenApe sign-in or read anything else in Reports.')
    expect(wrapper.text()).toContain('It can send what it shows to other websites.')
    expect(wrapper.text()).toContain('It loads 1 image from other websites.')
    expect(fetch).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === 'Open report')!.trigger('click'); await flushPromises()
    expect(fetch).toHaveBeenCalledWith('/api/documents/report/viewer', { method: 'POST', query: { revision: 1 } })
    expect(wrapper.get('iframe').attributes()).toMatchObject({ sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', src: 'about:blank' })
    expect(wrapper.text()).not.toContain('Open this report?')
  })
  it('asks again for a different version', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ url: 'about:blank' }))
    wrapper = mount(HtmlReport, { props: { report }, global, attachTo: document.body }); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Open report')!.trigger('click'); await flushPromises()
    await wrapper.setProps({ report: { ...report, publication_id: 'other-version', version: 2 } }); await flushPromises()
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('Open this report?')
  })
  it('gives the opened report the whole height below the bar without page scroll', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ url: 'about:blank' }))
    wrapper = mount(HtmlReport, { props: { report }, global, attachTo: document.body }); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Open report')!.trigger('click'); await flushPromises()
    const bar = wrapper.get('header').element.getBoundingClientRect()
    const frame = wrapper.get('iframe').element.getBoundingClientRect()
    expect(bar.height).toBe(48)
    expect(frame.top).toBe(bar.bottom)
    expect(frame.bottom).toBe(innerHeight)
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(innerHeight)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  })
  it('shows a denied viewer without inserting any document HTML', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('revoked')))
    wrapper = mount(HtmlReport, { props: { report }, global }); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Open report')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('access changed')
    expect(wrapper.find('iframe').exists()).toBe(false)
  })
})
