import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import BriefingReport from '../../app/components/BriefingReport.vue'
import { sampleBriefing } from '../briefing-fixture'

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
