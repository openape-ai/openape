import { describe, expect, it } from 'vitest'
import { collectFlag, missingCapabilities, parseKeyValues } from '../src/commands/agent/deploy'

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

describe('collectFlag', () => {
  it('collects every occurrence of a repeated flag (citty would keep only the last)', () => {
    const raw = ['repo@v1', '--param', 'repo=https://x/y.git', '--param', 'forge=github']
    expect(collectFlag(raw, 'param')).toEqual(['repo=https://x/y.git', 'forge=github'])
  })

  it('handles the --flag=value form', () => {
    expect(collectFlag(['--param=repo=A', '--param=forge=B'], 'param')).toEqual(['repo=A', 'forge=B'])
  })

  it('keeps param and secret flags independent', () => {
    const raw = ['--param', 'repo=A', '--secret', 'GH_TOKEN=ghp_x']
    expect(collectFlag(raw, 'param')).toEqual(['repo=A'])
    expect(collectFlag(raw, 'secret')).toEqual(['GH_TOKEN=ghp_x'])
  })

  it('returns [] when the flag is absent', () => {
    expect(collectFlag(['--other', 'x'], 'param')).toEqual([])
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
