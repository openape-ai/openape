import type { WireEvent } from '../app/utils/attention-inbox'
import { describe, expect, it } from 'vitest'
import { agentRecords, metricsFromEvents, suggestedSampling } from '../app/utils/attention-metrics'

let seq = 0
function event(type: string, ts: number, payload: Record<string, unknown> = {}, taskRef = 'ape-tasks:T1', actor = 'agent:a1'): WireEvent {
  seq++
  return {
    id: `EV${String(seq).padStart(24, '0')}`,
    ts,
    actor,
    actor_kind: 'agent',
    task_ref: taskRef,
    type,
    payload,
  }
}

function answered(requestType: string, requestedAt: number, resolutionType: string, answeredAt: number, extra: Record<string, unknown> = {}, taskRef = 'ape-tasks:T1', actor = 'agent:a1') {
  const request = event(requestType, requestedAt, {}, taskRef, actor)
  const resolution = event(resolutionType, answeredAt, { request_id: request.id, ...extra }, taskRef, actor)
  return [request, resolution]
}

describe('median wait — how long the machine waits for the human', () => {
  it('is null while nothing has been answered', () => {
    expect(metricsFromEvents([event('verdict.requested', 100)]).medianWaitSeconds).toBeNull()
  })

  it('takes the middle value, not the average', () => {
    const events = [
      ...answered('verdict.requested', 0, 'verdict.given', 10, { verdict: 'merge' }),
      ...answered('verdict.requested', 0, 'verdict.given', 20, { verdict: 'merge' }),
      ...answered('verdict.requested', 0, 'verdict.given', 600, { verdict: 'merge' }),
    ]
    // Average would be 210 — one slow answer must not distort the picture.
    expect(metricsFromEvents(events).medianWaitSeconds).toBe(20)
  })

  it('averages the two middle values on an even count', () => {
    const events = [
      ...answered('decision.requested', 0, 'decision.made', 10, { decision: 'a' }),
      ...answered('decision.requested', 0, 'decision.made', 30, { decision: 'b' }),
    ]
    expect(metricsFromEvents(events).medianWaitSeconds).toBe(20)
  })

  it('ignores cards that resolved themselves — nobody waited for those', () => {
    const events = [
      ...answered('decision.requested', 0, 'decision.made', 60, { decision: 'x' }),
      ...answered('decision.requested', 0, 'decision.made', 86400, { decision: 'y', auto: true }),
    ]
    expect(metricsFromEvents(events).medianWaitSeconds).toBe(60)
  })
})

describe('autonomy rate — how often the work ran without interrupting', () => {
  it('is null before anything shipped', () => {
    expect(metricsFromEvents([event('work.started', 1)]).autonomyRate).toBeNull()
  })

  it('counts a task that shipped without a question as autonomous', () => {
    const events = [event('work.started', 1), event('task.shipped', 9)]
    expect(metricsFromEvents(events).autonomyRate).toBe(1)
  })

  it('does not count a task that had to ask', () => {
    const events = [
      event('work.started', 1, {}, 'ape-tasks:A'),
      event('work.blocked', 2, { question: 'wohin?' }, 'ape-tasks:A'),
      event('task.shipped', 9, {}, 'ape-tasks:A'),
      event('task.shipped', 9, {}, 'ape-tasks:B'),
    ]
    expect(metricsFromEvents(events).autonomyRate).toBe(0.5)
  })

  it('still counts a task that only needed a review — reviewing is the point', () => {
    const events = [
      ...answered('verdict.requested', 1, 'verdict.given', 5, { verdict: 'merge' }, 'ape-tasks:A'),
      event('task.shipped', 9, {}, 'ape-tasks:A'),
    ]
    expect(metricsFromEvents(events).autonomyRate).toBe(1)
  })
})

describe('rework rate — a proxy for spec quality', () => {
  it('is null before any verdict', () => {
    expect(metricsFromEvents([]).reworkRate).toBeNull()
  })

  it('counts only rework against the total of verdicts', () => {
    const events = [
      ...answered('verdict.requested', 0, 'verdict.given', 1, { verdict: 'merge' }),
      ...answered('verdict.requested', 0, 'verdict.given', 1, { verdict: 'rework' }),
      ...answered('verdict.requested', 0, 'verdict.given', 1, { verdict: 'reject' }),
      ...answered('verdict.requested', 0, 'verdict.given', 1, { verdict: 'merge' }),
    ]
    expect(metricsFromEvents(events).reworkRate).toBe(0.25)
  })
})

describe('counters', () => {
  it('separates what was answered from what is still open', () => {
    const events = [
      ...answered('verdict.requested', 0, 'verdict.given', 5, { verdict: 'merge' }),
      event('decision.requested', 10, { question: 'offen?' }),
      event('proof.attached', 11, { url: 'https://x', kind: 'pr' }),
    ]
    const metrics = metricsFromEvents(events)
    expect(metrics.answered).toBe(1)
    expect(metrics.openNow).toBe(1)
  })
})

describe('suggested sampling — deliberately conservative', () => {
  it('samples everything until there is a track record', () => {
    expect(suggestedSampling(19, 1)).toBe(1)
    expect(suggestedSampling(0, 1)).toBe(1)
  })

  it('lowers the rate in steps as the clean rate holds', () => {
    expect(suggestedSampling(20, 0.95)).toBe(0.1)
    expect(suggestedSampling(50, 0.9)).toBe(0.25)
    expect(suggestedSampling(50, 0.8)).toBe(0.5)
  })

  it('goes back to everything when the clean rate drops', () => {
    expect(suggestedSampling(200, 0.79)).toBe(1)
  })
})

describe('agent records', () => {
  it('attributes a verdict to the agent that asked for it, not the human who gave it', () => {
    const [request, resolution] = answered('verdict.requested', 0, 'verdict.given', 5, { verdict: 'merge' }, 'ape-tasks:A', 'agent:frontend')
    const human = { ...resolution!, actor: 'patrick@hofmann.eco', actor_kind: 'human' as const }
    const [record] = agentRecords([request!, human])
    expect(record).toMatchObject({ agent: 'agent:frontend', reviews: 1, merged: 1, reworked: 0, cleanRate: 1 })
  })

  it('counts rework against the clean rate', () => {
    const events = [
      ...answered('verdict.requested', 0, 'verdict.given', 1, { verdict: 'merge' }, 'ape-tasks:A', 'agent:x'),
      ...answered('verdict.requested', 0, 'verdict.given', 1, { verdict: 'rework' }, 'ape-tasks:B', 'agent:x'),
    ]
    const [record] = agentRecords(events)
    expect(record).toMatchObject({ reviews: 2, merged: 1, reworked: 1, cleanRate: 0.5, suggestedSampling: 1 })
  })

  it('lists the busiest agent first', () => {
    const events = [
      ...answered('verdict.requested', 0, 'verdict.given', 1, { verdict: 'merge' }, 'ape-tasks:A', 'agent:quiet'),
      ...answered('verdict.requested', 0, 'verdict.given', 1, { verdict: 'merge' }, 'ape-tasks:B', 'agent:busy'),
      ...answered('verdict.requested', 0, 'verdict.given', 1, { verdict: 'merge' }, 'ape-tasks:C', 'agent:busy'),
    ]
    expect(agentRecords(events).map(r => r.agent)).toEqual(['agent:busy', 'agent:quiet'])
  })

  it('ignores a verdict whose request it never saw', () => {
    const orphan = event('verdict.given', 5, { verdict: 'merge', request_id: 'EV000000000000000000000999' })
    expect(agentRecords([orphan])).toEqual([])
  })
})
