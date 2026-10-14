import { describe, expect, it } from 'vitest'
import { InvalidGrantSummaryError, migrateLegacyGrantSummary, parseGrantSummary } from '../grant-summary.js'

describe('request summary', () => {
  it('accepts the four fields and keeps description line breaks', () => {
    expect(parseGrantSummary(undefined)).toBeUndefined()
    const summary = { title: 'Rebase PR 395 onto main', description: 'Two commits.\nNo conflicts.', origin: 'IURIO rebase', link: 'https://repos.openape.ai/patrick/monorepo/pulls/395' }
    expect(parseGrantSummary(summary)).toEqual(summary)
    expect(parseGrantSummary({ title: 'x'.repeat(120), description: '😀'.repeat(2000) })).toEqual({ title: 'x'.repeat(120), description: '😀'.repeat(2000) })
  })

  it('refuses the removed text field with a pointer to its replacement', () => {
    expect(() => parseGrantSummary({ text: 'Archive one mail' })).toThrow(/summary\.text is no longer supported/)
    expect(() => parseGrantSummary({ title: 'Archive', text: 'Archive one mail' })).toThrow(InvalidGrantSummaryError)
  })

  it.each([
    ['not an object', 'Archive'],
    ['an array', [{ title: 'x' }]],
    ['a missing title', { description: 'x' }],
    ['a blank title', { title: '   ' }],
    ['a long title', { title: 'x'.repeat(121) }],
    ['a two-line title', { title: 'Archive\nnow' }],
    ['a tab in the title', { title: 'Archive\tnow' }],
    ['a bidi override in the title', { title: 'Archive \u202Eexe.txt' }],
    ['a bidi isolate in the origin', { title: 'x', origin: 'Pod \u2066x\u2069' }],
    ['a zero-width space in the title', { title: 'git\u200Bpush' }],
    ['a line separator in the description', { title: 'x', description: 'a\u2028b' }],
    ['a carriage return in the description', { title: 'x', description: 'a\r\nb' }],
    ['a long description', { title: 'x', description: 'x'.repeat(2001) }],
    ['a two-line origin', { title: 'x', origin: 'a\nb' }],
    ['a long origin', { title: 'x', origin: 'x'.repeat(121) }],
    ['a non-string link', { title: 'x', link: 1 }],
    ['an unknown field', { title: 'x', approve: true }],
  ])('refuses %s', (_name, value) => {
    expect(() => parseGrantSummary(value)).toThrow(InvalidGrantSummaryError)
  })
})

describe('legacy summary migration', () => {
  it('splits the first non-empty line into the title and keeps the rest as description', () => {
    expect(migrateLegacyGrantSummary({ text: '\n  Archive "Newsletter XY"  \n\nFrom news@xy.example\nReceived today\n\n', link: 'https://mail.example/1' }))
      .toEqual({ title: 'Archive "Newsletter XY"', description: 'From news@xy.example\nReceived today', link: 'https://mail.example/1' })
    expect(migrateLegacyGrantSummary({ text: 'One line only' })).toEqual({ title: 'One line only' })
  })

  it('shortens a long first line at a word boundary and keeps the full line in the description', () => {
    const line = `${'word '.repeat(40)}end`
    const migrated = migrateLegacyGrantSummary({ text: `${line}\nsecond` })!
    expect([...migrated.title].length).toBeLessThanOrEqual(120)
    expect(migrated.title).toMatch(/^word( word)+…$/)
    expect(migrated.description).toBe(`${line}\nsecond`)
  })

  it('removes characters the current rules refuse and drops an unusable link', () => {
    expect(migrateLegacyGrantSummary({ text: 'Pay\u202E now\r\nline\ttwo\u200B', link: 'javascript:\u0000' }))
      .toEqual({ title: 'Pay now', description: 'line two' })
  })

  it('returns nothing for a blank text', () => {
    expect(migrateLegacyGrantSummary({ text: ' \n\t\n' })).toBeUndefined()
  })

  it('always produces a summary the current rules accept', () => {
    for (const text of ['x'.repeat(5000), `${'y'.repeat(300)}\n${'z '.repeat(3000)}`, 'a\u2029b\u0085c']) {
      const migrated = migrateLegacyGrantSummary({ text })!
      expect(parseGrantSummary(migrated)).toEqual(migrated)
    }
  })
})
