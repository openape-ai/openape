import { describe, expect, it } from 'vitest'
import {
  doneSummary,
  missingRest,
  formatAge,
  formatValue,
  labelForKey,
  themeGroups,
  summaryChips,
  toneForKey,
  totalWaiting,
} from '../app/utils/kpi-display'

let seq = 0
function kpi(scope: string, key: string, value = 1, unit: string | null = null) {
  return { id: String(++seq), scope, key, value, unit, createdAt: 0 }
}

describe('labelForKey', () => {
  it('humanizes known keys and passes unknown ones through', () => {
    expect(labelForKey('mail.attention')).toBe('Mails, die Aufmerksamkeit brauchen')
    expect(labelForKey('dev.prs_merged_24h')).toBe('Gemergte PRs (24 h)')
    expect(labelForKey('rechnungen.abgelegt')).toBe('Abgelegte Rechnungen')
    expect(labelForKey('custom.metric')).toBe('custom.metric')
  })
})

describe('toneForKey', () => {
  it('flags waiting work amber and empty attention green', () => {
    expect(toneForKey('mail.attention', 10)).toBe('attention')
    expect(toneForKey('mail.attention', 0)).toBe('done')
    expect(toneForKey('tasks.open', 17)).toBe('attention')
    expect(toneForKey('dev.prs_merged_24h', 3)).toBe('done')
    expect(toneForKey('rechnungen.abgelegt', 2)).toBe('done')
    expect(toneForKey('grants.pending', 2)).toBe('attention')
    expect(toneForKey('grants.pending', 0)).toBe('done')
    expect(labelForKey('grants.pending')).toBe('Grants warten auf Freigabe')
    expect(labelForKey('calendar.upcoming')).toBe('Termine (nächste 7 Tage)')
    expect(toneForKey('custom.metric', 5)).toBe('neutral')
  })
})

describe('themeGroups', () => {
  it('groups by metric key in fixed briefing order with account members', () => {
    const groups = themeGroups([
      kpi('dev/openape', 'dev.prs_merged_24h', 3),
      kpi('tasks', 'tasks.open', 17),
      kpi('hofmann.eco', 'mail.attention', 0, 'mails'),
      kpi('delta-mind', 'mail.attention', 10, 'mails'),
      kpi('docpit', 'calendar.upcoming', 3, 'Termine'),
    ])
    expect(groups.map(g => g.key)).toEqual(['mail.attention', 'calendar.upcoming', 'tasks.open', 'dev.prs_merged_24h'])
    const mail = groups[0]!
    expect(mail.label).toBe('Mails, die Aufmerksamkeit brauchen')
    expect(mail.total).toBe(10)
    expect(mail.tone).toBe('attention')
    expect(mail.members.map(m => m.scope)).toEqual(['delta-mind', 'hofmann.eco'])
  })

  it('tones a theme done only when every member is done', () => {
    const groups = themeGroups([
      kpi('a', 'mail.attention', 0, 'mails'),
      kpi('b', 'mail.attention', 0, 'mails'),
    ])
    expect(groups[0]!.tone).toBe('done')
  })
})

describe('summaryChips', () => {
  it('builds anchor chips for attention KPIs, biggest first', () => {
    const a = kpi('delta-mind', 'mail.attention', 10, 'mails')
    const b = kpi('tasks', 'tasks.open', 17)
    const chips = summaryChips([a, b, kpi('dev/openape', 'dev.prs_merged_24h', 3)])
    expect(chips).toEqual([
      { id: b.id, text: 'tasks: 17' },
      { id: a.id, text: 'delta-mind: 10 mails' },
    ])
  })
})

describe('doneSummary + totalWaiting', () => {
  it('summarizes handled work and sums the waiting count', () => {
    const kpis = [
      kpi('delta-mind', 'mail.attention', 10, 'mails'),
      kpi('tasks', 'tasks.open', 17),
      kpi('hofmann.eco', 'mail.attention', 0, 'mails'),
      kpi('dev/openape', 'dev.prs_merged_24h', 3),
    ]
    expect(doneSummary(kpis)).toEqual(['hofmann.eco leer', '3 gemergte PRs (24 h)'])
    expect(totalWaiting(kpis)).toBe(27)
  })
})

describe('missingRest', () => {
  it('is 0 when the list covers the value or a rest marker completes it', () => {
    expect(missingRest(3, '<ul><li>a</li><li>b</li><li>c</li></ul>')).toBe(0)
    expect(missingRest(17, '<ul><li>a</li><li>b</li><li>c</li><li>+14 weitere</li></ul>')).toBe(0)
  })

  it('reports the gap when the list under-covers the value', () => {
    expect(missingRest(10, '<ul><li>a</li><li>b</li></ul>')).toBe(8)
    expect(missingRest(17, '<ul><li>a</li><li>+10 weitere</li></ul>')).toBe(6)
  })

  it('ignores non-list details and non-integer values', () => {
    expect(missingRest(5, '<h2>kein Listen-Detail</h2>')).toBe(0)
    expect(missingRest(2.5, '<ul><li>a</li></ul>')).toBe(0)
    expect(missingRest(0, '<ul><li>a</li></ul>')).toBe(0)
  })
})

describe('formatting', () => {
  it('formats values and ages', () => {
    expect(formatValue(kpi('a', 'k', 2.5))).toBe('2.50')
    expect(formatValue(kpi('a', 'k', 3))).toBe('3')
    expect(formatAge(0, 90 * 60000)).toBe('vor 2 h')
    expect(formatAge(0, 5 * 60000)).toBe('vor 5 min')
  })
})
