import { h, nextTick, Suspense } from 'vue'
import { commands, page } from 'vitest/browser'
import { routeBoundary, screenshotPath } from './harness'
import { installNuxtGlobals } from './report-fixture'
import ReportPage from '../../app/pages/r/[slug].vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import BriefingReport from '../../app/components/BriefingReport.vue'
import { sampleBriefing, sampleBriefingV2 } from '../briefing-fixture'

let wrapper: ReturnType<typeof mount>
afterEach(() => wrapper?.unmount())
it('renders source text safely, identifies gaps and lets the reader change appearance', async () => {
  const report = sampleBriefing()
  report.emails[0]!.subject = '<img src=x onerror="alert(1)">'
  report.emails[0]!.summary = '<script>document.body.remove()</script>'
  wrapper = mount(BriefingReport, { props: { report, version: 1, latestVersion: 2, editions: [{ version: 1, date: report.editionDate }, { version: 2, date: '2026-09-28' }] }, attachTo: document.body })
  expect(wrapper.text()).toContain(report.emails[0]!.subject)
  expect(wrapper.text()).toContain(report.emails[0]!.summary)
  expect(wrapper.findAll('img, script, iframe')).toHaveLength(0)
  expect(wrapper.text()).toContain('Personal events may be missing')
  expect(wrapper.text()).toContain('frühere Ausgabe')
  await nextTick()
  await wrapper.get('select[aria-label="Darstellung"]').setValue('dark')
  expect(wrapper.get('.briefing').attributes('data-theme')).toBe('dark')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
  const links = wrapper.findAll('a[target="_blank"]')
  expect(links.length).toBeGreaterThan(0)
  expect(links.every(link => link.attributes('rel') === 'noopener noreferrer')).toBe(true)
})

it('shows a mail summary and next action once while preserving unrelated report content', () => {
  const report = sampleBriefing()
  const mail = report.emails[0]!
  report.importantItems.push({ id: 'duplicate', title: mail.subject, summary: mail.summary, priority: 'high', sourceIds: ['mail'] })
  report.nextActions.push({ id: 'duplicate', text: mail.nextAction, sourceIds: ['mail'], url: mail.url })
  wrapper = mount(BriefingReport, { props: { report, version: 1, latestVersion: 1, editions: [] } })
  expect(wrapper.text().split(mail.subject)).toHaveLength(2)
  expect(wrapper.text().split(mail.summary)).toHaveLength(2)
  expect(wrapper.text().split(mail.nextAction)).toHaveLength(2)
  expect(wrapper.text()).toContain(report.importantItems[0]!.title)
  expect(wrapper.text()).toContain('Deine Nachrichten')
  expect(wrapper.text()).toContain('27. September 2026')
  expect(wrapper.attributes('lang')).toBe('de')
})

it.each([
  { width: 390, height: 844, theme: 'light' as const },
  { width: 390, height: 844, theme: 'dark' as const },
  { width: 1440, height: 1000, theme: 'light' as const },
  { width: 1440, height: 1000, theme: 'dark' as const },
])('renders the real briefing page at $width px in $theme without horizontal overflow', async ({ width, height, theme }) => {
  await page.viewport(width, height)
  await commands.setColorScheme(theme)
  const report = sampleBriefing()
  installNuxtGlobals({
    type: 'briefing',
    briefing: report,
    version: 1,
    latest_version: 2,
    editions: [{ version: 1, date: report.editionDate }, { version: 2, date: '2026-09-28' }],
    created_by: 'owner@example.test',
    created_by_act: 'agent',
    created_at: 1,
    visibility: 'private',
  })
  wrapper = mount({ render: () => h(Suspense, null, { default: () => h(ReportPage) }) }, { global: routeBoundary, attachTo: document.body })
  await flushPromises()
  await wrapper.get('select[aria-label="Darstellung"]').setValue(theme)
  const briefing = wrapper.get('.briefing')
  expect(briefing.attributes('data-theme')).toBe(theme)
  expect(getComputedStyle(briefing.element).backgroundColor).toBe(theme === 'dark' ? 'rgb(20, 35, 31)' : 'rgb(247, 246, 241)')
  expect(briefing.text()).toContain('Personal events may be missing')
  expect(wrapper.get('.docbar h1').text()).toBe(report.title)
  expect(wrapper.get('.docbar a.pill').attributes('href')).toBe('/r/demo')
  expect(wrapper.get('select#briefing-edition').element).toHaveProperty('value', '1')
  expect(wrapper.findAll('select#briefing-edition option').map(option => option.attributes('value'))).toEqual(['1', '2'])
  expect(getComputedStyle(wrapper.get('label[for="briefing-theme"]').element).position).toBe('absolute')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  expect(wrapper.get('.native').element.scrollWidth).toBeLessThanOrEqual(width)
  await page.screenshot({ path: screenshotPath(`briefing-${width}-${theme}`) })
})

it.each([320, 390, 768, 1280].flatMap(width => (['light', 'dark'] as const).map(theme => ({ width, theme }))))('presents v2 focus, honest coverage and expandable originals at $width px in $theme', async ({ width, theme }) => {
  await page.viewport(width, 900)
  await commands.setColorScheme(theme)
  const report = sampleBriefingV2()
  wrapper = mount(BriefingReport, { props: { report, version: 2, latestVersion: 2, editions: [{ version: 2, date: report.editionDate }] }, attachTo: document.body })
  await nextTick()
  await wrapper.get('select[aria-label="Darstellung"]').setValue(theme)
  expect(wrapper.findAll('#focus > article')).toHaveLength(2)
  expect(wrapper.findAll('.original')).toHaveLength(4)
  expect(wrapper.text()).not.toContain('Du bist am Zug')
  expect(wrapper.text()).not.toContain('Offene Repository-Issues')
  expect(wrapper.get('.coverage-note').text()).toContain('3 Mailtexte berücksichtigt von 8 Inbox-Nachrichten')
  expect(wrapper.get('#agenda').text()).toContain('Keine Termine mit Uhrzeit heute')
  expect(wrapper.get('#agenda').text()).toContain('Ganztägig: National holiday')
  expect(wrapper.get('.conflicts').text()).toContain('30 Minuten')
  expect(wrapper.findAll('details[open]')).toHaveLength(0)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  for (const control of wrapper.findAll('summary, select, .coverage-note a')) expect(control.element.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  await commands.captureBriefing(`briefing-v2-${width}-${theme}`)
  const original = wrapper.get('.original summary').element as HTMLElement
  original.focus()
  await page.getByText('Sync failed: export.csv', { exact: false }).first().click()
  expect(wrapper.get('.original').element).toHaveProperty('open', true)
  expect(wrapper.get('.original .byline').text()).toContain('monitor@example.com')
  await wrapper.get('.more-information summary').trigger('click')
  expect(wrapper.get('.more-information').element).toHaveProperty('open', true)
  document.documentElement.style.fontSize = '200%'
  await nextTick()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  document.documentElement.style.fontSize = ''
})
