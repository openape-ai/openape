import { describe, expect, it } from 'vitest'
import { answerOf, openCalls, parseDuration } from '../src/commands/calls'

let seq = 0
function event(type: string, ts: number, payload: Record<string, unknown> = {}) {
  seq++
  return {
    id: `EV${String(seq).padStart(24, '0')}`,
    ts,
    actor: 'agent:a1',
    actor_kind: 'agent' as const,
    task_ref: 'ape-tasks:T1',
    type,
    payload,
  }
}

describe('openCalls', () => {
  it('lists the longest-waiting first — that one blocks the most', () => {
    const calls = openCalls([
      event('decision.requested', 300, { question: 'b?' }),
      event('verdict.requested', 100),
      event('work.blocked', 200, { question: 'c?' }),
    ])
    expect(calls.map(c => c.ts)).toEqual([100, 200, 300])
  })

  it('drops a call once its answer exists', () => {
    const request = event('verdict.requested', 100)
    const answer = event('verdict.given', 150, { verdict: 'merge', request_id: request.id })
    expect(openCalls([request, answer])).toEqual([])
  })

  it('ignores proofs and lifecycle events', () => {
    const noise = [event('proof.attached', 1, { url: 'https://x', kind: 'pr' }), event('task.shipped', 2)]
    expect(openCalls(noise)).toEqual([])
  })

  it('speaks the call vocabulary: a raised call is open until it is answered', () => {
    const raised = event('call.raised', 100, { kind: 'verdict', pr_url: 'https://x' })
    expect(openCalls([raised])).toEqual([raised])
    const answered = event('call.answered', 150, { answer: 'merge', request_id: raised.id })
    expect(openCalls([raised, answered])).toEqual([])
  })
})

describe('answerOf', () => {
  it('reads a verdict', () => {
    expect(answerOf({ payload: { verdict: 'rework' } })).toBe('rework')
  })

  it('reads a decision', () => {
    expect(answerOf({ payload: { decision: 'pro Gerät' } })).toBe('pro Gerät')
  })

  it('reads a call.answered answer', () => {
    expect(answerOf({ payload: { answer: 'merge' } })).toBe('merge')
  })

  it('has no answer for an unresolved call', () => {
    expect(answerOf(null)).toBeNull()
  })
})

describe('parseDuration', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['1d', 86_400_000],
  ])('reads %s', (input, ms) => {
    expect(parseDuration(input)).toBe(ms)
  })

  it('rejects anything it cannot honour instead of silently waiting forever', () => {
    expect(() => parseDuration('2 hours')).toThrow(/invalid duration/)
    expect(() => parseDuration('forever')).toThrow(/invalid duration/)
    expect(() => parseDuration('-5m')).toThrow(/invalid duration/)
  })
})
