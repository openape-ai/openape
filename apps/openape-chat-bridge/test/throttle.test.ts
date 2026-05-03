import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createThrottle } from '../src/throttle'

describe('createThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces multiple schedule() calls into one trailing fire', async () => {
    const fn = vi.fn(() => Promise.resolve())
    const t = createThrottle(fn, 300)
    t.schedule()
    t.schedule()
    t.schedule()
    expect(fn).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(300)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('flush() forces immediate fire and clears the timer', async () => {
    const fn = vi.fn(() => Promise.resolve())
    const t = createThrottle(fn, 300)
    t.schedule()
    t.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(300)
    // No second fire — the scheduled timer must have been cancelled.
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel() drops a scheduled fire', async () => {
    const fn = vi.fn(() => Promise.resolve())
    const t = createThrottle(fn, 300)
    t.schedule()
    t.cancel()
    await vi.advanceTimersByTimeAsync(300)
    expect(fn).not.toHaveBeenCalled()
  })

  it('coalesces schedule() that arrives during an in-flight call', async () => {
    let resolveFirst: (() => void) | null = null
    const fn = vi.fn(() => new Promise<void>((resolve) => {
      // First call hangs until we release it; subsequent calls resolve sync.
      if (!resolveFirst) {
        resolveFirst = resolve
      }
      else {
        resolve()
      }
    }))
    const t = createThrottle(fn, 100)
    t.schedule()
    await vi.advanceTimersByTimeAsync(100)
    expect(fn).toHaveBeenCalledTimes(1) // first fire in flight

    t.schedule()
    await vi.advanceTimersByTimeAsync(100)
    // The throttle should NOT start a second fire while the first is in
    // flight; it marks pendingFlush and runs once after the first resolves.
    expect(fn).toHaveBeenCalledTimes(1)

    resolveFirst!()
    await vi.runAllTimersAsync()
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
