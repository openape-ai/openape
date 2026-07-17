import { describe, expect, it } from 'vitest'
import { agentStatus, claimNext, enqueue, getTask, markAgentPoll, resolve, restoreTask } from '../server/utils/cockpit/queue'

describe('cockpit queue — owner-bound', () => {
  it('an agent only ever claims its own owner\'s tasks', () => {
    const a = enqueue('c1', 'sp', 'A', 'alice@x')
    const b = enqueue('c2', 'sp', 'B', 'bob@x')
    expect(claimNext('bob@x')?.id).toBe(b.id)
    expect(claimNext('alice@x')?.id).toBe(a.id)
    expect(claimNext('carol@x')).toBeNull()
  })

  it('restoreTask re-offers a persisted task with its original id (boot rehydrate)', () => {
    restoreTask({ id: 'restored-1', company: 'c', owner: 'frank@x', systemPrompt: 'sp', userMessage: 'do it', createdAt: 1 })
    const t = claimNext('frank@x')
    expect(t?.id).toBe('restored-1')
    expect(t?.userMessage).toBe('do it')
    expect(t?.state).toBe('working')
  })

  it('restoreTask is idempotent — a duplicate id is not re-queued', () => {
    restoreTask({ id: 'restored-2', company: 'c', owner: 'gina@x', systemPrompt: 'sp', userMessage: 'x', createdAt: 1 })
    restoreTask({ id: 'restored-2', company: 'c', owner: 'gina@x', systemPrompt: 'sp', userMessage: 'x', createdAt: 1 })
    expect(claimNext('gina@x')?.id).toBe('restored-2')
    expect(claimNext('gina@x')).toBeNull()
  })

  it('an agent can only resolve its own owner\'s tasks', () => {
    const t = enqueue('c', 'sp', 'q', 'dave@x')
    claimNext('dave@x')
    expect(resolve(t.id, 'completed', 'hijacked', 'eve@x')).toBe(false)
    expect(getTask(t.id)?.answer).toBe('')
    expect(resolve(t.id, 'completed', 'ok', 'dave@x')).toBe(true)
    expect(getTask(t.id)?.answer).toBe('ok')
  })

  it('never polled => offline', () => {
    expect(agentStatus('nobody@x').mode).toBe('offline')
  })
  it('a short promised next-poll => actively bursting', () => {
    markAgentPoll('burst@x', 5000)
    expect(agentStatus('burst@x').mode).toBe('active')
  })
  it('a long promised next-poll => idle with a countdown', () => {
    markAgentPoll('rip@x', 60000)
    const s = agentStatus('rip@x')
    expect(s.mode).toBe('idle')
    expect(s.nextPollInSec).toBeGreaterThan(50)
    expect(s.nextPollInSec).toBeLessThanOrEqual(60)
  })
  it('an open claimed task => working (overrides idle)', () => {
    enqueue('cx', 'sp', 'q', 'work@x')
    markAgentPoll('work@x', 60000) // would be idle…
    claimNext('work@x') // …but now a task is in flight
    expect(agentStatus('work@x').mode).toBe('working')
  })
})
