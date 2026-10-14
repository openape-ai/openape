import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCliAuthDetail, matchArgvToOperation } from '@openape/grants'
import { describe, expect, it } from 'vitest'
import { parseAdapterToml } from '../src/toml.js'

// Golden permissions recorded with the parser before declared value options
// existed (issue 1468). Stored grants carry these permission strings, so every
// argv must keep deriving exactly the same operation, permission and display.
// The gh cases were re-recorded for issue 1473: the fixture now binds owner and
// repository name as separate resources; the old chain granted every
// repository of an owner.
interface GoldenCase {
  adapter: string
  argv: string[]
  expected: null | { error: string } | { operation_id: string, permission: string, display: string, exact_command: boolean }
}

const fixturesDir = join(import.meta.dirname, 'fixtures')
const cases = JSON.parse(readFileSync(join(fixturesDir, 'option-binding-golden.json'), 'utf8')) as GoldenCase[]

function derive(adapterFile: string, argv: string[]): GoldenCase['expected'] {
  const adapter = parseAdapterToml(readFileSync(join(fixturesDir, adapterFile), 'utf8'))
  const match = matchArgvToOperation(adapter.operations, argv)
  if (!match)
    return null
  try {
    const detail = buildCliAuthDetail(adapter.cli.id, match.operation, match.bindings)
    return { operation_id: detail.operation_id, permission: detail.permission, display: detail.display, exact_command: detail.constraints?.exact_command === true }
  }
  catch (error) {
    return { error: (error as Error).message }
  }
}

describe('permission derivation for existing adapters', () => {
  it('covers matched, unmatched and invalid argv', () => {
    expect(cases.filter(entry => entry.expected && 'permission' in entry.expected).length).toBeGreaterThan(150)
    expect(cases.some(entry => entry.expected === null)).toBe(true)
  })

  it.each(cases.map(entry => [`${entry.adapter}: ${entry.argv.join(' ')}`, entry] as const))('%s', (_, entry) => {
    expect(derive(entry.adapter, entry.argv)).toEqual(entry.expected)
  })
})
