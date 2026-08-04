import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Six work packages translate this app in parallel, each owning its own
// top-level namespace. The one thing they all touch is these two files, so the
// failure mode is a key that exists in one locale and not the other — invisible
// until someone switches language. This test is the gate.
const LOCALES = join(import.meta.dirname, '../i18n/locales')

function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
}

function keysOf(locale: string): string[] {
  return flatten(JSON.parse(readFileSync(join(LOCALES, `${locale}.json`), 'utf8'))).sort()
}

describe('locale parity', () => {
  it('de and en carry the same keys', () => {
    const de = keysOf('de')
    const en = keysOf('en')
    expect(de.filter(k => !en.includes(k))).toEqual([])
    expect(en.filter(k => !de.includes(k))).toEqual([])
  })

  it('no key is left as an empty string', () => {
    for (const locale of ['de', 'en']) {
      const flat = JSON.parse(readFileSync(join(LOCALES, `${locale}.json`), 'utf8'))
      const empties = flatten(flat).filter((path) => {
        const value = path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], flat)
        return value === ''
      })
      expect(empties, `${locale} has empty strings`).toEqual([])
    }
  })
})
