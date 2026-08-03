import { describe, expect, it } from 'vitest'
import { ulidLike, verdictRequestedEvents } from './attention-emit'

const ctx = {
  actor: 'agent+a1+hofmann_eco@id.openape.ai',
  actorKind: 'agent' as const,
  taskRef: 'ape-tasks:01KZ3QAAAA0000000000TASK01',
  reviewUrl: 'https://pr.openape.ai/p/abc',
}

describe('verdictRequestedEvents', () => {
  it('raises a verdict card and attaches the PR as its proof', () => {
    const [card, proof] = verdictRequestedEvents(ctx, 1_785_758_183)
    expect(card).toMatchObject({
      type: 'verdict.requested',
      actor: ctx.actor,
      actor_kind: 'agent',
      task_ref: ctx.taskRef,
      ts: 1_785_758_183,
      payload: { pr_url: ctx.reviewUrl },
    })
    expect(proof).toMatchObject({
      type: 'proof.attached',
      task_ref: ctx.taskRef,
      payload: { url: ctx.reviewUrl, kind: 'pr' },
    })
  })

  it('gives each event its own id', () => {
    const [card, proof] = verdictRequestedEvents(ctx, 1)
    expect(card!.id).not.toBe(proof!.id)
  })
})

describe('ulidLike', () => {
  it('emits 26 Crockford chars, time-ordered', () => {
    const a = ulidLike(1_785_758_183_000)
    const b = ulidLike(1_785_758_184_000)
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true)
  })
})
