import { describe, expect, it } from 'vitest'
import { computeOverlaps } from './overlap'

describe('computeOverlaps', () => {
  it('no overlap for adjacent intervals', () => {
    const r = computeOverlaps([
      { id: 'a', startedAt: 100, endedAt: 200 },
      { id: 'b', startedAt: 200, endedAt: 300 },
    ])
    expect([...r]).toEqual([])
  })

  it('flags both sides of an overlap', () => {
    const r = computeOverlaps([
      { id: 'a', startedAt: 100, endedAt: 250 },
      { id: 'b', startedAt: 200, endedAt: 300 },
    ])
    expect(r).toEqual(new Set(['a', 'b']))
  })

  it('contained interval overlaps', () => {
    const r = computeOverlaps([
      { id: 'outer', startedAt: 0, endedAt: 1000 },
      { id: 'inner', startedAt: 400, endedAt: 500 },
      { id: 'far', startedAt: 2000, endedAt: 2100 },
    ])
    expect(r).toEqual(new Set(['outer', 'inner']))
  })

  it('ignores entries missing bounds', () => {
    const r = computeOverlaps([
      { id: 'a', startedAt: 100, endedAt: 300 },
      { id: 'b', startedAt: null, endedAt: null },
    ])
    expect([...r]).toEqual([])
  })

  it('three-way overlap flags all', () => {
    const r = computeOverlaps([
      { id: 'a', startedAt: 0, endedAt: 300 },
      { id: 'b', startedAt: 100, endedAt: 400 },
      { id: 'c', startedAt: 250, endedAt: 500 },
    ])
    expect(r).toEqual(new Set(['a', 'b', 'c']))
  })
})
