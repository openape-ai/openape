// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import AgentRecords from '../app/components/AgentRecords.vue'
import MetricTiles from '../app/components/MetricTiles.vue'
import de from '../i18n/locales/de.json'

// The tiles read the shipped German catalog — including where a percentage
// puts its space, which is exactly the kind of thing a locale decides.
const i18n = createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de } })
vi.stubGlobal('useI18n', () => i18n.global)

const global = { plugins: [i18n], stubs: { NuxtLink: { template: '<a><slot /></a>' } } }
const empty = { medianWaitSeconds: null, autonomyRate: null, reworkRate: null, answered: 0, openNow: 0 }

describe('metric tiles', () => {
  it('shows a dash instead of a zero when nothing has been measured yet', () => {
    const text = mount(MetricTiles, { props: { metrics: empty }, global }).text()
    expect(text).toContain('—')
    expect(text).not.toContain('0 %')
  })

  it.each([
    [45, '45 s'],
    [600, '10 min'],
    [7200, '2 h'],
    [259200, '3 d'],
  ])('renders a wait of %i seconds as "%s"', (seconds, expected) => {
    const text = mount(MetricTiles, { props: { metrics: { ...empty, medianWaitSeconds: seconds } }, global }).text()
    expect(text).toContain(expected)
  })

  it('renders rates as whole percentages', () => {
    const metrics = { ...empty, autonomyRate: 0.8123, reworkRate: 0.0 }
    const text = mount(MetricTiles, { props: { metrics }, global }).text()
    expect(text).toContain('81 %')
    expect(text).toContain('0 %')
  })

  it('puts the open count next to the answered count', () => {
    const text = mount(MetricTiles, { props: { metrics: { ...empty, answered: 7, openNow: 2 } }, global }).text()
    expect(text).toContain('7')
    expect(text).toContain('2 offen')
  })
})

describe('agent records', () => {
  const record = {
    agent: 'agent:frontend',
    reviews: 42,
    merged: 40,
    reworked: 2,
    cleanRate: 40 / 42,
    suggestedSampling: 0.25,
  }

  it('shows reviews, clean rate and the suggested sampling', () => {
    const text = mount(AgentRecords, { props: { records: [record] }, global }).text()
    expect(text).toContain('agent:frontend')
    expect(text).toContain('42 Reviews')
    expect(text).toContain('95 % ohne Nacharbeit')
    expect(text).toContain('Sampling 25 %')
  })

  it('says "1 Review" in the singular', () => {
    const single = { ...record, reviews: 1, merged: 1, reworked: 0, cleanRate: 1, suggestedSampling: 1 }
    expect(mount(AgentRecords, { props: { records: [single] }, global }).text()).toContain('1 Review ')
  })

  it('explains why a new agent is sampled fully', () => {
    const fresh = { ...record, reviews: 4, suggestedSampling: 1 }
    const badge = mount(AgentRecords, { props: { records: [fresh] }, global }).find('[title]')
    expect(badge.attributes('title')).toContain('Unter 20 Reviews')
  })

  it('invites the first review instead of showing an empty box', () => {
    expect(mount(AgentRecords, { props: { records: [] }, global }).text()).toContain('Noch keine Reviews')
  })
})
