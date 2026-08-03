import { describe, expect, it } from 'vitest'
import { ulid, verdictRequestedEvents } from '../src/attention'

const who = {
  actor: 'agent+a1+hofmann_eco@id.openape.ai',
  actorKind: 'agent' as const,
  taskRef: 'ape-tasks:01KZ3QAAAA0000000000TASK01',
}

describe('verdictRequestedEvents', () => {
  it('raises a verdict card with the PR as its proof', () => {
    const [card, proof] = verdictRequestedEvents(who, 'https://pr.openape.ai/prs/abc', 1_785_758_183)
    expect(card).toMatchObject({
      type: 'verdict.requested',
      actor: who.actor,
      actor_kind: 'agent',
      task_ref: who.taskRef,
      ts: 1_785_758_183,
      payload: { pr_url: 'https://pr.openape.ai/prs/abc' },
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
