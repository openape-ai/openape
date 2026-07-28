import { describe, expect, it } from 'vitest'
import { answerTask, claimNext, enqueue, getTask, resolve, restoreTask } from '../server/utils/cockpit/queue'

const ASK = { question: 'A oder B?', options: ['A', 'B'] }

describe('input-required — ask & answer on the same task', () => {
  it('an asked task is not claimable and carries question/options', () => {
    const t = enqueue('c', 'sp', 'mach was', 'ask1@x')
    expect(claimNext('ask1@x')?.id).toBe(t.id)
    expect(resolve(t.id, 'input-required', 'brauche eine Entscheidung', 'ask1@x', undefined, ASK)).toBe(true)
    const q = getTask(t.id)!
    expect(q.state).toBe('input-required')
    expect(q.question).toBe('A oder B?')
    expect(q.options).toEqual(['A', 'B'])
    expect(q.progress).toContain('brauche eine Entscheidung')
    expect(claimNext('ask1@x')).toBeNull()
  })

  it('answerTask resumes the SAME task with the choice appended', () => {
    const t = enqueue('c', 'sp', 'mach was', 'ask2@x')
    claimNext('ask2@x')
    resolve(t.id, 'input-required', '', 'ask2@x', undefined, ASK)
    expect(answerTask(t.id, 'ask2@x', 'A')).toBe(true)
    const resumed = claimNext('ask2@x')!
    expect(resumed.id).toBe(t.id)
    expect(resumed.userMessage).toContain('[Rückfrage] A oder B?')
    expect(resumed.userMessage).toContain('[Antwort] A')
    expect(resumed.progress).toContain('Antwort des Owners: A')
    expect(resumed.question).toBeUndefined()
  })

  it('a foreign owner can neither ask nor answer', () => {
    const t = enqueue('c', 'sp', 'mach was', 'ask3@x')
    claimNext('ask3@x')
    expect(resolve(t.id, 'input-required', '', 'fremd@x', undefined, ASK)).toBe(false)
    expect(getTask(t.id)?.state).toBe('working')
    resolve(t.id, 'input-required', '', 'ask3@x', undefined, ASK)
    expect(answerTask(t.id, 'fremd@x', 'A')).toBe(false)
    expect(getTask(t.id)?.state).toBe('input-required')
  })

  it('answering a task that is not asking is rejected', () => {
    const t = enqueue('c', 'sp', 'mach was', 'ask4@x')
    expect(answerTask(t.id, 'ask4@x', 'A')).toBe(false)
  })

  it('restoreTask brings a persisted question back AS input-required, not claimable', () => {
    restoreTask({ id: 'ask-restored', company: 'c', owner: 'ask5@x', systemPrompt: 'sp', userMessage: 'm', createdAt: 1, question: 'Deploy?', options: ['Ja', 'Nein'], askedAt: Date.now() })
    expect(claimNext('ask5@x')).toBeNull()
    const q = getTask('ask-restored')!
    expect(q.state).toBe('input-required')
    expect(q.options).toEqual(['Ja', 'Nein'])
    expect(answerTask('ask-restored', 'ask5@x', 'Ja')).toBe(true)
    expect(claimNext('ask5@x')?.id).toBe('ask-restored')
  })
})

describe('worker-wrapper final resolve must not clobber a paused task (#1005)', () => {
  it('completed after input-required is ignored — the question survives', () => {
    const t = enqueue('c', 'sp', 'frag mich', 'wrap1@x')
    claimNext('wrap1@x')
    resolve(t.id, 'input-required', '', 'wrap1@x', undefined, { question: 'Deploy?', options: ['Ja'] })
    // worker.sh answer() fires its final completed AFTER the agent already paused the task
    expect(resolve(t.id, 'completed', 'Ich habe dich gefragt.', 'wrap1@x')).toBe(false)
    expect(getTask(t.id)?.state).toBe('input-required')
    expect(answerTask(t.id, 'wrap1@x', 'Ja')).toBe(true)
  })

  it('completed after deferred is ignored — the retry survives', () => {
    const t = enqueue('c', 'sp', 'warte auf CI', 'wrap2@x')
    claimNext('wrap2@x')
    resolve(t.id, 'deferred', 'warte', 'wrap2@x', 60_000)
    expect(resolve(t.id, 'completed', 'Ich warte auf CI.', 'wrap2@x')).toBe(false)
    const task = getTask(t.id)!
    expect(task.state).toBe('submitted')
    expect(task.notBefore).toBeGreaterThan(Date.now())
  })
})

describe('duplicate terminal resolve is a no-op (#1011)', () => {
  it('preserves the first completed result', () => {
    const t = enqueue('c', 'sp', 'still', 'silent1@x')
    claimNext('silent1@x')
    expect(resolve(t.id, 'completed', '', 'silent1@x')).toBe(true)
    expect(resolve(t.id, 'completed', 'Wrapper-Echo', 'silent1@x')).toBe(false)
    expect(getTask(t.id)?.state).toBe('completed')
    expect(getTask(t.id)?.answer).toBe('')
  })

  it('preserves the first failed result', () => {
    const t = enqueue('c', 'sp', 'still', 'silent2@x')
    claimNext('silent2@x')
    expect(resolve(t.id, 'failed', 'Fehler', 'silent2@x')).toBe(true)
    expect(resolve(t.id, 'failed', 'Wrapper-Echo', 'silent2@x')).toBe(false)
    expect(getTask(t.id)?.answer).toBe('Fehler')
  })
})
