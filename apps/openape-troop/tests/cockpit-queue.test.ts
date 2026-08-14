import { describe, expect, it, vi } from 'vitest'
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
    restoreTask({ id: 'restored-1', company: 'c', owner: 'frank@x', systemPrompt: 'sp', userMessage: 'do it', createdAt: 1, notBefore: Date.now() + 60_000, lastNote: 'warte auf CI' })
    const t = claimNext('frank@x')
    expect(t).toBeNull()
    expect(getTask('restored-1')?.notBefore).toBeGreaterThan(Date.now())
    expect(getTask('restored-1')?.progress).toEqual(['warte auf CI'])
    getTask('restored-1')!.notBefore = Date.now() - 1
    expect(claimNext('frank@x')?.id).toBe('restored-1')
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

  it('defers a task until notBefore and keeps its progress note', () => {
    const t = enqueue('c', 'sp', 'q', 'wait@x')
    expect(claimNext('wait@x')?.id).toBe(t.id)
    expect(resolve(t.id, 'deferred', 'warte auf CI', 'wait@x', 120_000)).toBe(true)
    expect(getTask(t.id)?.progress).toEqual(['warte auf CI'])
    expect(claimNext('wait@x')).toBeNull()
  })

  it('releases a deferred task after its delay', () => {
    const t = enqueue('c', 'sp', 'q', 'later@x')
    claimNext('later@x')
    resolve(t.id, 'deferred', '', 'later@x', 1)
    expect(getTask(t.id)?.notBefore).toBeGreaterThan(Date.now())
    const task = getTask(t.id)!
    task.notBefore = Date.now() - 1
    expect(claimNext('later@x')?.id).toBe(t.id)
  })

  it('a queued task survives a batch longer than the claimed-task window', () => {
    const waiting = enqueue('c', 'sp', 'letzte Duty im Batch', 'batch@x')
    getTask(waiting.id)!.createdAt = Date.now() - 90 * 60_000
    enqueue('c', 'sp', 'der nächste Trigger', 'batch@x') // löst gcStaleTasks aus
    expect(claimNext('batch@x')?.id).toBe(waiting.id)
  })

  it('drops an abandoned task loudly instead of silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lost = enqueue('c', 'sp', 'nie geholt', 'lost@x')
    getTask(lost.id)!.createdAt = Date.now() - 7 * 60 * 60_000
    enqueue('c', 'sp', 'nächster', 'lost@x')
    expect(getTask(lost.id)).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(lost.id))
    warn.mockRestore()
  })

  it('a task claimed late still gets the FULL claimed-TTL, not one measured from submission (#1251 follow-up)', () => {
    // Sits unclaimed for 40 min — past the 30 min claimed-TTL but well inside
    // the 6 h unclaimed-TTL, so it survives to be claimed at all.
    const t = enqueue('c', 'sp', 'spät geholt', 'lateclaim@x')
    getTask(t.id)!.createdAt = Date.now() - 40 * 60_000
    expect(claimNext('lateclaim@x')?.id).toBe(t.id)
    // Trigger a GC well within the 30 min claimed-TTL counted from the claim —
    // if the TTL still measured against createdAt (already 40 min old) this
    // would wrongly drop a task that's mid-run.
    enqueue('c', 'sp', 'nächster Trigger', 'lateclaim@x')
    expect(getTask(t.id)?.state).toBe('working')
  })

  it('a claimed task is still dropped after the claimed-TTL, measured from the claim', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = enqueue('c', 'sp', 'hängt fest', 'stuck@x')
    expect(claimNext('stuck@x')?.id).toBe(t.id)
    getTask(t.id)!.claimedAt = Date.now() - 31 * 60_000
    enqueue('c', 'sp', 'nächster Trigger', 'stuck@x')
    expect(getTask(t.id)).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(t.id))
    warn.mockRestore()
  })

  it('regular completed/failed cleanup stays quiet (no console.warn)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = enqueue('c', 'sp', 'fertig', 'quiet@x')
    claimNext('quiet@x')
    resolve(t.id, 'completed', 'ok', 'quiet@x')
    enqueue('c', 'sp', 'nächster Trigger', 'quiet@x') // löst gcStaleTasks aus
    expect(getTask(t.id)).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
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
