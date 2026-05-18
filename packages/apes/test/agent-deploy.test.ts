import { describe, expect, it } from 'vitest'
import { missingCapabilities, parseKeyValues } from '../src/commands/agent/deploy'

describe('parseKeyValues', () => {
  it('parses KEY=value pairs (value may contain =)', () => {
    expect(parseKeyValues(['topic=AI agents', 'TOKEN=a=b=c'])).toEqual({
      topic: 'AI agents',
      TOKEN: 'a=b=c',
    })
  })

  it('last value wins on duplicate keys', () => {
    expect(parseKeyValues(['k=1', 'k=2'])).toEqual({ k: '2' })
  })

  it('returns {} for an empty list', () => {
    expect(parseKeyValues([])).toEqual({})
  })

  it.each(['noequals', '=novalue'])('rejects malformed pair %s', (p) => {
    expect(() => parseKeyValues([p])).toThrow(/bad key=value pair/)
  })
})

describe('missingCapabilities', () => {
  it('returns required envs not provided', () => {
    expect(missingCapabilities(['A', 'B', 'C'], { B: 'x' })).toEqual(['A', 'C'])
  })

  it('returns [] when all provided', () => {
    expect(missingCapabilities(['A'], { A: 'x' })).toEqual([])
  })

  it('returns [] when nothing required', () => {
    expect(missingCapabilities([], { A: 'x' })).toEqual([])
  })
})
