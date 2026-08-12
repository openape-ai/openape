import { describe, expect, it } from 'vitest'
import {
  groupByTopScope,
  latestPerKey,
  MAX_DETAIL_BYTES,
  scopeMatches,
  validateKpiInput,
} from '../server/utils/kpi-shape'

describe('validateKpiInput', () => {
  it('accepts a minimal push and defaults the scope', () => {
    const r = validateKpiInput({ key: 'mail.docpit.wichtig', value: 3 })
    expect(r).toEqual({ ok: true, kpi: { scope: 'general', key: 'mail.docpit.wichtig', value: 3, unit: undefined, detail: undefined } })
  })

  it('accepts a full push with slash-path scope', () => {
    const r = validateKpiInput({ scope: 'delta-mind/mail', key: 'wichtig', value: '2', unit: 'mails', detail: '## Top\n- a' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.kpi.scope).toBe('delta-mind/mail')
      expect(r.kpi.value).toBe(2)
    }
  })

  it.each([
    [null, 'body'],
    [{ value: 1 }, 'key required'],
    [{ key: 'a b', value: 1 }, 'key must match'],
    [{ key: 'k', value: 'zwei' }, 'finite number'],
    [{ key: 'k', value: Number.NaN }, 'finite number'],
    [{ key: 'k', value: 1, scope: '/leading' }, 'scope must be'],
    [{ key: 'k', value: 1, scope: 'a//b' }, 'scope must be'],
    [{ key: 'k', value: 1, unit: 'x'.repeat(33) }, 'unit must be'],
    [{ key: 'k', value: 1, detail: 42 }, 'detail must be a string'],
  ])('rejects %j', (body, message) => {
    const r = validateKpiInput(body)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toContain(message)
  })

  it('rejects an oversized detail by bytes, not chars', () => {
    const r = validateKpiInput({ key: 'k', value: 1, detail: 'ü'.repeat(MAX_DETAIL_BYTES / 2 + 1) })
    expect(r.ok).toBe(false)
  })
})

describe('scopeMatches', () => {
  it('matches exact and sub-paths, not sibling prefixes', () => {
    expect(scopeMatches('delta-mind', 'delta-mind')).toBe(true)
    expect(scopeMatches('delta-mind/mail', 'delta-mind')).toBe(true)
    expect(scopeMatches('delta-mindful', 'delta-mind')).toBe(false)
  })
})

describe('latestPerKey', () => {
  it('keeps only the newest row per (scope, key)', () => {
    const rows = [
      { scope: 'a', key: 'k', v: 3 },
      { scope: 'a', key: 'k', v: 2 },
      { scope: 'b', key: 'k', v: 1 },
    ]
    expect(latestPerKey(rows)).toEqual([
      { scope: 'a', key: 'k', v: 3 },
      { scope: 'b', key: 'k', v: 1 },
    ])
  })
})

describe('groupByTopScope', () => {
  it('groups by the first path segment', () => {
    const groups = groupByTopScope([
      { scope: 'delta-mind/mail' },
      { scope: 'delta-mind' },
      { scope: 'personal' },
    ])
    expect([...groups.keys()]).toEqual(['delta-mind', 'personal'])
    expect(groups.get('delta-mind')).toHaveLength(2)
  })
})
