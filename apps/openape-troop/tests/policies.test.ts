// @vitest-environment happy-dom
import type { WireEvent } from '../app/utils/attention-inbox'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import PolicyList from '../app/components/PolicyList.vue'
import { policiesFromEvents } from '../app/utils/policies'
import de from '../i18n/locales/de.json'

// The list renders the shipped German catalog, so the assertions stay on the
// strings a user sees.
const i18n = createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de } })

const global = { plugins: [i18n], stubs: { NuxtLink: { template: '<a><slot /></a>' } } }

function policyEvent(type: string, rule: string, ts: number, payload: Record<string, unknown> = {}): WireEvent {
  return {
    id: `01KZ5P0000F1XTVRE0000PCY${String(ts).slice(-2)}`,
    ts,
    actor: 'patrick@hofmann.eco',
    actor_kind: 'human',
    task_ref: 'ape-plans:01KZ3QPW5EC0JRXN5TB60R54TQ',
    type,
    payload: { rule, ...payload },
  }
}

describe('policiesFromEvents', () => {
  it('lists rules in force before proposals', () => {
    const list = policiesFromEvents([
      policyEvent('policy.proposed', 'Vorschlag', 20),
      policyEvent('policy.adopted', 'Gilt', 10),
    ])
    expect(list.map(p => [p.rule, p.adopted])).toEqual([['Gilt', true], ['Vorschlag', false]])
  })

  it('sorts each group newest first', () => {
    const list = policiesFromEvents([
      policyEvent('policy.adopted', 'alt', 10),
      policyEvent('policy.adopted', 'neu', 30),
    ])
    expect(list.map(p => p.rule)).toEqual(['neu', 'alt'])
  })

  it('drops a proposal once the same rule is adopted', () => {
    const list = policiesFromEvents([
      policyEvent('policy.proposed', 'Komponenten testen', 10),
      policyEvent('policy.adopted', 'Komponenten testen', 20),
    ])
    expect(list).toHaveLength(1)
    expect(list[0]!.adopted).toBe(true)
  })

  it('ignores everything that is not a policy event', () => {
    const noise = { ...policyEvent('decision.made', '', 5), payload: { decision: 'x' } }
    expect(policiesFromEvents([noise])).toEqual([])
  })

  it('carries origin, place of enforcement and rationale through', () => {
    const [policy] = policiesFromEvents([
      policyEvent('policy.adopted', 'Regel', 10, {
        rationale: 'Weil ein Screenshot kein Test ist.',
        enforced_in: '.claude/CLAUDE.md',
        source_id: '01KZ5NT798X8WJGPBHSMQKC041',
      }),
    ])
    expect(policy).toMatchObject({
      rationale: 'Weil ein Screenshot kein Test ist.',
      enforcedIn: '.claude/CLAUDE.md',
      sourceId: '01KZ5NT798X8WJGPBHSMQKC041',
    })
  })
})

describe('policy list', () => {
  it('shows the rule with its origin and where it binds', () => {
    const policies = policiesFromEvents([
      policyEvent('policy.adopted', 'Komponenten mit Logik bekommen einen Test.', 10, {
        rationale: 'Ein Screenshot ist ein Blick, kein Test.',
        enforced_in: '.claude/CLAUDE.md',
        source_id: '01KZ5NT798X8WJGPBHSMQKC041',
      }),
    ])
    const text = mount(PolicyList, { props: { policies }, global }).text()
    expect(text).toContain('in Kraft')
    expect(text).toContain('Komponenten mit Logik bekommen einen Test.')
    expect(text).toContain('Ein Screenshot ist ein Blick, kein Test.')
    expect(text).toContain('.claude/CLAUDE.md')
    expect(text).toContain('aus dieser Entscheidung')
  })

  it('marks a proposal as not yet binding', () => {
    const policies = policiesFromEvents([policyEvent('policy.proposed', 'Noch offen', 10)])
    expect(mount(PolicyList, { props: { policies }, global }).text()).toContain('Vorschlag')
  })

  it('explains the empty state instead of showing a blank page', () => {
    expect(mount(PolicyList, { props: { policies: [] }, global }).text()).toContain('Noch keine Regeln')
  })
})
