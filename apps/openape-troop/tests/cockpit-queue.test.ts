import { describe, expect, it } from 'vitest'
import { agentRecentlyActive, claimNext, enqueue, getTask, markAgentPoll, resolve } from '../server/utils/cockpit/queue'

describe('cockpit queue — owner-bound', () => {
  it('an agent only ever claims its own owner\'s tasks', () => {
    const a = enqueue('c1', 'sp', 'A', 'alice@x')
    const b = enqueue('c2', 'sp', 'B', 'bob@x')
    expect(claimNext('bob@x')?.id).toBe(b.id)
    expect(claimNext('alice@x')?.id).toBe(a.id)
    expect(claimNext('carol@x')).toBeNull()
  })

  it('an agent can only resolve its own owner\'s tasks', () => {
    const t = enqueue('c', 'sp', 'q', 'dave@x')
    claimNext('dave@x')
    expect(resolve(t.id, 'completed', 'hijacked', 'eve@x')).toBe(false)
    expect(getTask(t.id)?.answer).toBe('')
    expect(resolve(t.id, 'completed', 'ok', 'dave@x')).toBe(true)
    expect(getTask(t.id)?.answer).toBe('ok')
  })

  it('brain presence is tracked per owner', () => {
    markAgentPoll('alice@x')
    expect(agentRecentlyActive('alice@x', 1000)).toBe(true)
    expect(agentRecentlyActive('bob@x', 1000)).toBe(false)
  })
  it('a poll outside the window reads as disconnected (drives mock fallback)', () => {
    markAgentPoll('carol@x')
    // withinMs 0 => even a just-now poll is already outside the window
    expect(agentRecentlyActive('carol@x', 0)).toBe(false)
    // never polled => never connected
    expect(agentRecentlyActive('nobody@x')).toBe(false)
  })
})
