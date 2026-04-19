import { describe, expect, it } from 'vitest'
import { globToRegex, previewMatches, selectorValueMatches } from '../app/utils/glob-preview'

describe('globToRegex', () => {
  it('treats * as any chars and anchors the pattern', () => {
    const re = globToRegex('foo/*')
    expect(re.test('foo/bar')).toBe(true)
    expect(re.test('foo/bar/baz')).toBe(true)
    expect(re.test('other/bar')).toBe(false)
  })

  it('escapes regex metachars other than *', () => {
    expect(globToRegex('a.b').test('aXb')).toBe(false)
    expect(globToRegex('a.b').test('a.b')).toBe(true)
    expect(globToRegex('a+b').test('a+b')).toBe(true)
  })
})

describe('selectorValueMatches', () => {
  it('falls back to literal equality without a *', () => {
    expect(selectorValueMatches('openape', 'openape')).toBe(true)
    expect(selectorValueMatches('openape', 'openapi')).toBe(false)
  })

  it('matches prefix + suffix + middle globs', () => {
    expect(selectorValueMatches('/Users/x/*', '/Users/x/Docs')).toBe(true)
    expect(selectorValueMatches('*.ts', 'index.ts')).toBe(true)
    expect(selectorValueMatches('repo/*/src', 'repo/open/src')).toBe(true)
  })

  it('caps at 256 chars', () => {
    const long = '*'.repeat(257)
    expect(selectorValueMatches(long, 'any')).toBe(false)
  })
})

describe('previewMatches', () => {
  it('returns one row per sample', () => {
    const rows = previewMatches('foo*', ['foo', 'foobar', 'other'])
    expect(rows).toEqual([
      { sample: 'foo', matches: true },
      { sample: 'foobar', matches: true },
      { sample: 'other', matches: false },
    ])
  })

  it('empty pattern marks all samples as non-matching', () => {
    expect(previewMatches('', ['anything'])).toEqual([{ sample: 'anything', matches: false }])
  })
})
