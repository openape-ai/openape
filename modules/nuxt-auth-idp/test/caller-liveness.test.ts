import { describe, expect, it } from 'vitest'
import { callerState, formatCountdown, formatWaited } from '../src/runtime/utils/caller-liveness'

describe('callerState', () => {
  it('claims nothing when the requester did not say', () => {
    expect(callerState({}, 1000, 9999)).toEqual({ kind: 'unknown' })
    expect(callerState(undefined, 1000, 9999)).toEqual({ kind: 'unknown' })
  })

  it('reports the remaining time while the caller polls', () => {
    expect(callerState({ waits_until: 1300 }, 1000, 1042)).toEqual({ kind: 'waiting', secondsLeft: 258 })
  })

  it('flips to abandoned the second the deadline passes', () => {
    const request = { waits_until: 1300 }
    expect(callerState(request, 1000, 1299).kind).toBe('waiting')
    expect(callerState(request, 1000, 1300).kind).toBe('abandoned')
  })

  it('remembers how long the caller was willing to wait', () => {
    expect(callerState({ waits_until: 1300 }, 1000, 99999)).toEqual({ kind: 'abandoned', waitedSeconds: 300 })
  })
})

describe('formatCountdown over long waits', () => {
  it('counts a review deadline in hours, not in minutes', () => {
    expect(formatCountdown(86_385)).toBe('23 h 59 min')
    expect(formatCountdown(3600)).toBe('1 h 0 min')
  })

  it('keeps the stopwatch for anything under an hour', () => {
    expect(formatCountdown(3599)).toBe('59:59')
  })
})

describe('formatting', () => {
  it('shows a countdown with seconds, so it reads as one', () => {
    expect(formatCountdown(247)).toBe('4:07')
    expect(formatCountdown(60)).toBe('1:00')
    expect(formatCountdown(9)).toBe('0:09')
  })

  it('never counts below zero', () => {
    expect(formatCountdown(-5)).toBe('0:00')
  })

  it('rounds the waited span to something a human says out loud', () => {
    expect(formatWaited(300)).toBe('5 min')
    expect(formatWaited(45)).toBe('45 s')
  })
})
