import { describe, expect, it } from 'vitest'
import { assertVars } from '../server/utils/cockpit/vars'

describe('assertVars', () => {
  it('accepts a plain object, nested included', () => {
    expect(assertVars({ boardUser: 254, lanes: { sprint: 2617 } })).toEqual({ boardUser: 254, lanes: { sprint: 2617 } })
    expect(assertVars({})).toEqual({})
  })
  it.each([
    ['an array', [1, 2]],
    ['null', null],
    ['a string', '{"a":1}'],
    ['a number', 42],
  ])('rejects %s', (_label, value) => {
    expect(() => assertVars(value)).toThrow(/vars must be a JSON object/)
  })
})
