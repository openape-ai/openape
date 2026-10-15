import type { HtmlReportView } from '../../shared/html-view'
import { flushPromises, mount } from '@vue/test-utils'
import { commands, page } from 'vitest/browser'
import { routeBoundary as global, screenshotPath } from './harness'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HtmlReport from '../../app/components/HtmlReport.vue'

const report: HtmlReportView = { document_id: 'report', publication_id: 'version', version: 1, latest_version: 2, title: 'A report with deliberately long words for a narrow viewport', category: 'Test Runs', language: 'en', tags: ['reports', 'consolidation'], metadata: { 'verification.stage': 'production acceptance' }, author: 'owner@example.com', created_at: 1, artifact_digest: 'a'.repeat(64), policy_version: 'publisher-trusted-html/2', external_images: ['https://images.example.test/example.png'], external_links: ['https://example.test/evidence'], audience: 'private', team_id: null, expires_at: null, access_revision: 1, retention_revision: 1, caller_role: 'owner', url: '/d/report', version_url: '/d/report?v=1', legacy_plan_id: null }
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
  it.each([
    { width: 390, height: 844, theme: 'light' as const },
    { width: 390, height: 844, theme: 'dark' as const },
    { width: 1440, height: 1000, theme: 'light' as const },
    { width: 1440, height: 1000, theme: 'dark' as const },
  ])('fills the $width px $theme shell below the bar without page scroll', async ({ width, height, theme }) => {
    await page.viewport(width, height)
    await commands.setColorScheme(theme)
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ url: 'about:blank' }))
    wrapper = mount(HtmlReport, { props: { report }, global, attachTo: document.body }); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Open report')!.trigger('click'); await flushPromises()
    const bar = wrapper.get('header').element.getBoundingClientRect()
    const frame = wrapper.get('iframe').element.getBoundingClientRect()
    expect(getComputedStyle(wrapper.get('.reader').element).backgroundColor).toBe(theme === 'dark' ? 'rgb(18, 21, 24)' : 'rgb(236, 238, 234)')
    expect(bar.height).toBe(48)
    expect(frame.top).toBe(bar.bottom)
    expect(frame.bottom).toBe(innerHeight)
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(innerHeight)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    expect(wrapper.get('.docbar a.pill').attributes('href')).toBe('/d/report')
    await page.screenshot({ path: screenshotPath(`html-${width}-${theme}`) })
  })
  it('shows a denied viewer without inserting any document HTML', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('revoked')))
    wrapper = mount(HtmlReport, { props: { report }, global, attachTo: document.body }); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Open report')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('access changed')
    const alert = wrapper.get('[role=alert]').element.getBoundingClientRect()
    expect(alert.width).toBeGreaterThan(100)
    expect(alert.right).toBeLessThanOrEqual(innerWidth)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
    await page.screenshot({ path: screenshotPath('html-denied-narrow') })
    expect(wrapper.find('iframe').exists()).toBe(false)
  })
})

it('keeps the trust action disabled while the viewer request is pending', async () => {
  let resolveViewer!: (value: { url: string }) => void
  const fetch = vi.fn(() => new Promise<{ url: string }>((resolve) => { resolveViewer = resolve }))
  vi.stubGlobal('$fetch', fetch)
  wrapper = mount(HtmlReport, { props: { report }, global, attachTo: document.body })
  await flushPromises()
  await page.getByRole('button', { name: 'Open report', exact: true }).click()
  expect(wrapper.get('.gate-acts button').attributes('disabled')).toBeDefined()
  expect(wrapper.get('.gate-acts button').text()).toBe('Opening…')
  expect(wrapper.find('iframe').exists()).toBe(false)
  expect(fetch).toHaveBeenCalledOnce()
  await page.screenshot({ path: screenshotPath('html-loading-narrow') })
  resolveViewer({ url: 'about:blank' })
  await flushPromises()
  expect(wrapper.find('iframe').exists()).toBe(true)
})

it('opens real version details and preserves pinned and latest link destinations', async () => {
  const fetch = vi.fn().mockResolvedValue({
    items: [
      { version: 1, author: report.author, created_at: 1 },
      { version: 2, author: report.author, created_at: 2 },
    ],
  })
  vi.stubGlobal('$fetch', fetch)
  wrapper = mount(HtmlReport, { props: { report }, global, attachTo: document.body })
  await flushPromises()
  await page.getByRole('button', { name: 'Details, versions and download' }).click()
  await flushPromises()
  expect(fetch).toHaveBeenCalledWith('/api/documents/report/history', { query: { limit: 100 } })
  const versions = [...document.querySelectorAll<HTMLAnchorElement>('.versions a')]
  expect(versions.map(link => link.getAttribute('href'))).toEqual(['/d/report?v=1', '/d/report'])
  expect(versions[0]?.getAttribute('aria-current')).toBe('page')
  expect(versions[1]?.textContent).toContain('Latest')
  const dialog = wrapper.get('dialog').element as HTMLDialogElement
  expect(dialog.open).toBe(true)
  await Promise.all(dialog.getAnimations().map(animation => animation.finished))
  expect(dialog.getBoundingClientRect().width).toBeGreaterThan(100)
  expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth)
  await page.screenshot({ path: screenshotPath('html-version-details-narrow') })
})
