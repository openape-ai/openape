import { describe, expect, it } from 'vitest'
import { byStatusThenUpdated, currentPlans, formatRelative, historyPlans, statusColor } from '../app/utils/plan-status'

const plan = (status: 'draft' | 'active' | 'done' | 'archived', updated_at: number) => ({ status, updated_at })

describe('statusColor', () => {
  it.each([
    ['active', 'primary'],
    ['done', 'success'],
    ['archived', 'warning'],
    ['draft', 'neutral'],
  ] as const)('paints %s as %s', (status, colour) => {
    expect(statusColor(status)).toBe(colour)
  })
})

describe('ordering', () => {
  it('puts what is being worked on first', () => {
    const sorted = [plan('archived', 1), plan('draft', 1), plan('active', 1), plan('done', 1)].sort(byStatusThenUpdated)
    expect(sorted.map(p => p.status)).toEqual(['active', 'draft', 'done', 'archived'])
  })

  it('shows the freshest first within one status', () => {
    const sorted = [plan('active', 10), plan('active', 30), plan('active', 20)].sort(byStatusThenUpdated)
    expect(sorted.map(p => p.updated_at)).toEqual([30, 20, 10])
  })
})

describe('splitting current from history', () => {
  const all = [plan('done', 5), plan('active', 1), plan('draft', 9), plan('archived', 7)]

  it('keeps active and draft in the current list', () => {
    expect(currentPlans(all).map(p => p.status)).toEqual(['active', 'draft'])
  })

  it('keeps done and archived in the history, same order rule', () => {
    expect(historyPlans(all).map(p => p.status)).toEqual(['done', 'archived'])
  })

  it('never loses a plan between the two lists', () => {
    expect(currentPlans(all).length + historyPlans(all).length).toBe(all.length)
  })
})

describe('formatRelative', () => {
  const NOW = 1_785_800_000
  it.each([
    [NOW - 5, 'just now'],
    [NOW - 300, '5m ago'],
    [NOW - 7200, '2h ago'],
    [NOW - 172800, '2d ago'],
  ])('renders %i as "%s"', (ts, expected) => {
    expect(formatRelative(ts, NOW)).toBe(expected)
  })
})
