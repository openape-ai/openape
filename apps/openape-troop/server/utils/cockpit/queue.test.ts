import { describe, expect, it } from 'vitest'
import { agentRecentlyActive, claimNext, enqueue, markAgentPoll } from './queue'

describe('cockpit queue — owner-bound', () => {
  it('an agent only ever claims its own owner\'s tasks', () => {
    const a = enqueue('c1', 'sp', 'A', 'alice@x')
    const b = enqueue('c2', 'sp', 'B', 'bob@x')
    // bob's agent must never see alice's task
    expect(claimNext('bob@x')?.id).toBe(b.id)
    expect(claimNext('alice@x')?.id).toBe(a.id)
    // a third identity claims nothing
    expect(claimNext('carol@x')).toBeNull()
  })

  it('brain presence is tracked per owner', () => {
    markAgentPoll('alice@x')
    expect(agentRecentlyActive('alice@x', 1000)).toBe(true)
    expect(agentRecentlyActive('bob@x', 1000)).toBe(false)
  })
})
