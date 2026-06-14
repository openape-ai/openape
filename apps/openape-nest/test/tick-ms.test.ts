import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_NEST_TICK_MS, resolveNestTickMs } from '../src/lib/tick-ms'

describe('resolveNestTickMs', () => {
  it('uses a valid positive finite value', () => {
    expect(resolveNestTickMs('1500')).toBe(1500)
  })

  it('falls back on NaN and warns', () => {
    const log = vi.fn()
    expect(resolveNestTickMs('abc', log)).toBe(DEFAULT_NEST_TICK_MS)
    expect(log).toHaveBeenCalledWith(`nest: invalid OPENAPE_NEST_TICK_MS=${JSON.stringify('abc')}; falling back to ${DEFAULT_NEST_TICK_MS}ms`)
  })

  it('falls back on non-positive values', () => {
    expect(resolveNestTickMs('0')).toBe(DEFAULT_NEST_TICK_MS)
    expect(resolveNestTickMs('-5')).toBe(DEFAULT_NEST_TICK_MS)
  })
})
