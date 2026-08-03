import type { WireEvent } from '../app/utils/attention-inbox'
import { describe, expect, it } from 'vitest'
import { cardTitle, openRequests, waitingLabel } from '../app/utils/attention-inbox'

function event(partial: Partial<WireEvent> & Pick<WireEvent, 'id' | 'type'>): WireEvent {
  return {
    ts: 100,
    actor: 'agent:a1@x',
    actor_kind: 'agent',
    task_ref: 'ape-tasks:T1',
    payload: {},
    ...partial,
  }
}

describe('openRequests', () => {
  it('returns requests without resolution, oldest first', () => {
    const events = [
      event({ id: 'B', type: 'decision.requested', ts: 200, payload: { question: 'B?' } }),
      event({ id: 'A', type: 'verdict.requested', ts: 100 }),
      event({ id: 'C', type: 'work.blocked', ts: 300, payload: { question: 'C?' } }),
    ]
    expect(openRequests(events).map(e => e.id)).toEqual(['A', 'B', 'C'])
  })

  it('drops requests that have a resolving event', () => {
    const events = [
      event({ id: 'A', type: 'verdict.requested' }),
      event({ id: 'R', type: 'verdict.given', ts: 150, payload: { verdict: 'merge', request_id: 'A' } }),
      event({ id: 'B', type: 'decision.requested', ts: 120, payload: { question: 'B?' } }),
    ]
    expect(openRequests(events).map(e => e.id)).toEqual(['B'])
  })

  it('ignores non-request event types entirely', () => {
    const events = [
      event({ id: 'P', type: 'proof.attached', payload: { url: 'https://x', kind: 'pr' } }),
      event({ id: 'S', type: 'task.shipped' }),
    ]
    expect(openRequests(events)).toEqual([])
  })
})

describe('cardTitle', () => {
  it('uses the question for decisions and the task_ref for verdicts', () => {
    expect(cardTitle(event({ id: 'A', type: 'decision.requested', payload: { question: 'Wohin?' } }))).toBe('Wohin?')
    expect(cardTitle(event({ id: 'B', type: 'verdict.requested' }))).toBe('Verdict: ape-tasks:T1')
  })
})

describe('waitingLabel', () => {
  it.each([
    [120, 'wartet 2 min'],
    [7200, 'wartet 2 h'],
    [172800, 'wartet 2 d'],
  ])('renders %ss as "%s"', (age, label) => {
    expect(waitingLabel(event({ id: 'A', type: 'decision.requested', ts: 1000 }), 1000 + age)).toBe(label)
  })
})
