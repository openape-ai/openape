// @vitest-environment happy-dom
import type { WireEvent } from '../app/utils/attention-inbox'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DecisionCard from '../app/components/DecisionCard.vue'

// Nuxt UI components are globally auto-imported in the app; here they are
// stubbed to plain elements so assertions read the text, not the design system.
const global = {
  stubs: {
    UButton: { template: '<button><slot /></button>' },
    UAlert: { template: '<div><slot /></div>' },
    UIcon: true,
    NuxtLink: { template: '<a><slot /></a>' },
  },
}

const NOW = 1_785_800_000

function decisionCard(payload: Record<string, unknown> = {}): WireEvent {
  return {
    id: '01KZ5GXREGW2QGFH5QVME32QNH',
    ts: NOW - 600,
    actor: 'claude@session',
    actor_kind: 'agent',
    task_ref: 'ape-plans:01KZ3QPW5EC0JRXN5TB60R54TQ',
    type: 'decision.requested',
    payload: {
      title: 'e2e nur noch vor dem Merge?',
      summary: 'Der e2e-Job braucht 15 Minuten und läuft bei jedem Push.',
      question: 'Wann soll e2e laufen?',
      options: ['Bei jedem Push', 'Nur vor dem Merge'],
      option_summaries: [
        { option: 'Bei jedem Push', summary: 'Maximale Sicherheit, kostet Wartezeit.' },
        { option: 'Nur vor dem Merge', summary: 'Schnelles Iterieren, Beweis bleibt vor dem Merge.' },
      ],
      recommendation: 'Nur vor dem Merge',
      recommendation_why: 'Behält den Beweis dort, wo er zählt.',
      blocks: 'CI-Umbau',
      ...payload,
    },
  }
}

const resolution: WireEvent = {
  id: '01KZ5H0000000000000000RES1',
  ts: NOW,
  actor: 'patrick@hofmann.eco',
  actor_kind: 'human',
  task_ref: 'ape-plans:01KZ3QPW5EC0JRXN5TB60R54TQ',
  type: 'decision.made',
  payload: { decision: 'Nur vor dem Merge', request_id: '01KZ5GXREGW2QGFH5QVME32QNH' },
}

describe('decision card — before the decision', () => {
  const text = () => mount(DecisionCard, { props: { event: decisionCard(), now: NOW }, global }).text()

  it('leads with the headline and the executive summary', () => {
    expect(text()).toContain('e2e nur noch vor dem Merge?')
    expect(text()).toContain('Der e2e-Job braucht 15 Minuten')
  })

  it('explains what each option means', () => {
    expect(text()).toContain('Maximale Sicherheit, kostet Wartezeit.')
    expect(text()).toContain('Schnelles Iterieren, Beweis bleibt vor dem Merge.')
  })

  it('says why the recommendation is the recommendation', () => {
    expect(text()).toContain('Warum diese Empfehlung')
    expect(text()).toContain('Behält den Beweis dort, wo er zählt.')
  })

  it('shows what the card blocks and how long it has waited', () => {
    expect(text()).toContain('blockiert CI-Umbau')
    expect(text()).toContain('wartet 10 min')
  })

  it('offers one button per option', () => {
    const buttons = mount(DecisionCard, { props: { event: decisionCard(), now: NOW }, global }).findAll('button')
    expect(buttons.map(b => b.text().replace(/\s+/g, ' ').trim())).toEqual([
      'Bei jedem Push',
      'Nur vor dem Merge (Empfehlung)',
    ])
  })

  it('emits the chosen option', async () => {
    const card = mount(DecisionCard, { props: { event: decisionCard(), now: NOW }, global })
    await card.findAll('button')[1]!.trigger('click')
    expect(card.emitted('resolve')).toEqual([[{ choice: 'Nur vor dem Merge' }]])
  })
})

describe('decision card — after the decision', () => {
  const decided = () => mount(DecisionCard, { props: { event: decisionCard(), resolution, now: NOW }, global })

  it('keeps the whole briefing readable', () => {
    const text = decided().text()
    expect(text).toContain('Der e2e-Job braucht 15 Minuten')
    expect(text).toContain('Maximale Sicherheit, kostet Wartezeit.')
    expect(text).toContain('Behält den Beweis dort, wo er zählt.')
  })

  it('appends who decided what', () => {
    const text = decided().text()
    expect(text).toContain('Nur vor dem Merge')
    expect(text).toContain('patrick@hofmann.eco')
  })

  it('takes the buttons away so nobody decides twice', () => {
    expect(decided().findAll('button')).toHaveLength(0)
  })
})

describe('verdict card', () => {
  const verdict: WireEvent = {
    id: '01KZ5H0000000000000000VRD1',
    ts: NOW - 3600,
    actor: 'claude@session',
    actor_kind: 'agent',
    task_ref: 'openape:pr-1171',
    type: 'verdict.requested',
    payload: {
      title: 'e2e-Suiten lokal mit einem Kommando',
      summary: 'Bisher musste man sich die turbo-Aufrufe aus dem Workflow zusammensuchen.',
      highlights: ['3 Dateien, +180/-2', '6 Tests grün'],
      pr_url: 'https://git.openape.ai/openape-ai/openape/pulls/1171',
      recommendation: 'merge',
      recommendation_why: 'Lokal bewiesen, CI grün.',
    },
  }

  it('summarises the change instead of showing only a link', () => {
    const text = mount(DecisionCard, { props: { event: verdict, now: NOW }, global }).text()
    expect(text).toContain('e2e-Suiten lokal mit einem Kommando')
    expect(text).toContain('Bisher musste man sich die turbo-Aufrufe')
    expect(text).toContain('3 Dateien, +180/-2')
    expect(text).toContain('Lokal bewiesen, CI grün.')
  })

  it('marks the recommended verdict among the three buttons', () => {
    const buttons = mount(DecisionCard, { props: { event: verdict, now: NOW }, global }).findAll('button')
    expect(buttons.map(b => b.text().replace(/\s+/g, ' ').trim())).toEqual([
      'Merge (Empfehlung)',
      'Nacharbeit',
      'Ablehnen',
    ])
  })
})
