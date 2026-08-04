import { describe, expect, it } from 'vitest'
import { lifecycleEvent, proofAttachedEvent, ulid, verdictRequestedEvents } from '../src/attention'

const who = {
  actor: 'agent+a1+hofmann_eco@id.openape.ai',
  actorKind: 'agent' as const,
  taskRef: 'ape-tasks:01KZ3QAAAA0000000000TASK01',
}

describe('verdictRequestedEvents', () => {
  it('raises a verdict call with the PR as its proof', () => {
    const [card, proof] = verdictRequestedEvents(who, 'https://pr.openape.ai/prs/abc', 1_785_758_183)
    expect(card).toMatchObject({
      type: 'call.raised',
      actor: who.actor,
      actor_kind: 'agent',
      task_ref: who.taskRef,
      ts: 1_785_758_183,
      payload: { kind: 'verdict', pr_url: 'https://pr.openape.ai/prs/abc' },
    })
    expect(proof).toMatchObject({ type: 'proof.attached', payload: { url: 'https://pr.openape.ai/prs/abc', kind: 'pr' } })
    expect(card!.id).not.toBe(proof!.id)
  })
})

describe('ulid', () => {
  it('emits 26 Crockford chars, time-ordered', () => {
    expect(ulid(1_785_758_183_000)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(ulid(1_785_758_183_000).slice(0, 10) < ulid(1_785_758_184_000).slice(0, 10)).toBe(true)
  })
})

describe('verdict briefing', () => {
  it('carries headline, summary and highlights onto the card', () => {
    const [card] = verdictRequestedEvents(who, 'https://pr.openape.ai/prs/abc', 1, {
      title: 'CLI-Emitter statt App-Emitter',
      summary: 'Bearer sind audience-scoped.',
      highlights: ['8 Dateien, +260/-1'],
    })
    expect(card!.payload).toMatchObject({
      pr_url: 'https://pr.openape.ai/prs/abc',
      title: 'CLI-Emitter statt App-Emitter',
      summary: 'Bearer sind audience-scoped.',
      highlights: ['8 Dateien, +260/-1'],
    })
  })

  it('omits empty briefing fields instead of sending blanks', () => {
    const [card] = verdictRequestedEvents(who, 'https://pr.openape.ai/prs/abc', 1, { title: '', highlights: [] })
    expect(card!.payload).toEqual({ kind: 'verdict', pr_url: 'https://pr.openape.ai/prs/abc' })
  })
})

describe('proof and lifecycle events', () => {
  it('attaches a testrun report as proof', () => {
    const event = proofAttachedEvent(who, 'https://testrun.openape.ai/r/kx3f', 'testrun', 1_785_758_183)
    expect(event).toMatchObject({
      type: 'proof.attached',
      task_ref: who.taskRef,
      actor_kind: 'agent',
      ts: 1_785_758_183,
      payload: { url: 'https://testrun.openape.ai/r/kx3f', kind: 'testrun' },
    })
  })

  it('records the lifecycle without a payload — these are counters, not cards', () => {
    expect(lifecycleEvent(who, 'work.started', 1)).toMatchObject({ type: 'work.started', payload: {} })
    expect(lifecycleEvent(who, 'task.shipped', 1)).toMatchObject({ type: 'task.shipped', payload: {} })
  })

  it('gives every event its own id', () => {
    const a = proofAttachedEvent(who, 'https://x.example/a', 'log', 1)
    const b = lifecycleEvent(who, 'task.shipped', 1)
    expect(a.id).not.toBe(b.id)
  })
})
