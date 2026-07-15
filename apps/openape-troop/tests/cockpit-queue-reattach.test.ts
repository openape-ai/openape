import { describe, expect, it } from 'vitest'
import { claimNext, enqueue, getTask, resolve } from '../server/utils/cockpit/queue'

// The reattach endpoint (GET tasks/<id>/progress) is a thin owner-gated read over
// getTask — these lock the data path it depends on.
describe('cockpit queue — reattach data path', () => {
  it('exposes live progress and the final answer via getTask', () => {
    const { id } = enqueue('acme', 'sys', 'hi', 'owner@x')
    claimNext('owner@x')
    resolve(id, 'working', '🧠 denkt …', 'owner@x')
    expect(getTask(id)?.state).toBe('working')
    expect(getTask(id)?.progress).toContain('🧠 denkt …')
    resolve(id, 'completed', 'FERTIG', 'owner@x')
    expect(getTask(id)?.state).toBe('completed')
    expect(getTask(id)?.answer).toBe('FERTIG')
  })
  it('a foreign owner cannot resolve into someone else’s task', () => {
    const { id } = enqueue('acme', 'sys', 'hi', 'owner@x')
    claimNext('owner@x')
    expect(resolve(id, 'completed', 'HACK', 'intruder@x')).toBe(false)
    expect(getTask(id)?.answer).toBe('')
  })
})
