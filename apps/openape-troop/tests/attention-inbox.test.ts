import type { Translatable, WireEvent } from '../app/utils/attention-inbox'
import { describe, expect, it } from 'vitest'
import { cardTitle, openRequests, waitingLabel } from '../app/utils/attention-inbox'
import de from '../i18n/locales/de.json'

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
    expect(cardTitle(event({ id: 'A', type: 'decision.requested', payload: { question: 'Wohin?' } })))
      .toEqual({ key: 'inbox.cardTitle.plain', params: { text: 'Wohin?' } })
    expect(cardTitle(event({ id: 'B', type: 'verdict.requested' })))
      .toEqual({ key: 'inbox.cardTitle.verdict', params: { ref: 'ape-tasks:T1' } })
  })
})

describe('waitingLabel', () => {
  it.each([
    [120, 'inbox.waitingFor.minutes', 2],
    [7200, 'inbox.waitingFor.hours', 2],
    [172800, 'inbox.waitingFor.days', 2],
  ])('renders %ss as %s with count %i', (age, key, count) => {
    expect(waitingLabel(event({ id: 'A', type: 'decision.requested', ts: 1000 }), 1000 + age))
      .toEqual({ key, params: { count } })
  })
})

// Both folds hand the component a key instead of a sentence, so a typo would
// otherwise reach the screen as the key itself. These are the keys they name.
describe('the keys these folds name', () => {
  const message = (key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], de)

  it.each<Translatable>([
    cardTitle(event({ id: 'A', type: 'decision.requested', payload: { question: 'Wohin?' } })),
    cardTitle(event({ id: 'B', type: 'verdict.requested' })),
    waitingLabel(event({ id: 'C', type: 'decision.requested', ts: 1000 }), 1120),
    waitingLabel(event({ id: 'D', type: 'decision.requested', ts: 1000 }), 8200),
    waitingLabel(event({ id: 'E', type: 'decision.requested', ts: 1000 }), 173800),
  ])('exist in the shipped catalog: $key', ({ key, params }) => {
    const text = message(key)
    expect(typeof text, `${key} is missing from de.json`).toBe('string')
    for (const name of Object.keys(params)) expect(text).toContain(`{${name}}`)
  })
})

describe('call vocabulary', () => {
  const call = (kind: string, payload: Record<string, unknown> = {}): WireEvent => ({
    id: '01KZ6C0000F1XTVRE00000CA51',
    ts: 100,
    actor: 'agent:a1',
    actor_kind: 'agent',
    task_ref: 'ape-tasks:T1',
    type: 'call.raised',
    payload: { kind, ...payload },
  })

  it('reads the kind off a raised call', async () => {
    const { callKind } = await import('../app/utils/attention-inbox')
    expect(callKind(call('verdict'))).toBe('verdict')
    expect(callKind(call('escalation'))).toBe('escalation')
    expect(callKind(call('decision'))).toBe('decision')
  })

  it('derives the kind from the older types, so both render the same', async () => {
    const { callKind } = await import('../app/utils/attention-inbox')
    expect(callKind({ ...call('x'), type: 'verdict.requested' })).toBe('verdict')
    expect(callKind({ ...call('x'), type: 'work.blocked' })).toBe('escalation')
    expect(callKind({ ...call('x'), type: 'decision.requested' })).toBe('decision')
  })

  it('treats a raised call as open until it is answered', () => {
    const raised = call('decision', { question: 'wohin?' })
    expect(openRequests([raised])).toHaveLength(1)
    const answered = { ...raised, id: 'ANS', type: 'call.answered', ts: 200, payload: { answer: 'links', request_id: raised.id } }
    expect(openRequests([raised, answered])).toHaveLength(0)
  })

  it('mixes both vocabularies in one inbox without double-counting', () => {
    const old = { ...call('decision'), id: 'OLD', type: 'decision.requested', ts: 50, payload: { question: 'alt?' } }
    expect(openRequests([old, call('decision', { question: 'neu?' })]).map(e => e.id)).toEqual(['OLD', '01KZ6C0000F1XTVRE00000CA51'])
  })
})
