import type { ChatMessage } from '../app/utils/cockpit/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCockpitChat } from '../app/composables/useCockpitChat'
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

// The client half: how the chat reacts when that progress read fails. Both
// helpers reach the composable as Nuxt auto-imports, so the test supplies them
// as globals.
const progressFetch = vi.fn()
const messagesFetch = vi.fn()

vi.stubGlobal('apiFetch', progressFetch)
vi.stubGlobal('$fetch', messagesFetch)
vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))

const POLLED_ANSWER = 'AUS DEM MESSAGES-POLL'

// Drives one chip tap, which re-attaches to the still-running task.
async function tapChoice(): Promise<ChatMessage> {
  const { messages, answer } = useCockpitChat()
  const asked: ChatMessage = { id: 'q', role: 'assistant', content: 'Welche Variante?', createdAt: Date.now(), ask: { taskId: 't1', options: ['A', 'B'] } }
  messages.value.push(asked)
  await answer(asked, 'A')
  return messages.value.at(-1)!
}

beforeEach(() => {
  progressFetch.mockReset()
  messagesFetch.mockReset()
  // The answer POST resolves; the persisted-answer poll always has a fallback
  // ready, so a lost re-attach is visible as the wrong text, not as a hang.
  messagesFetch.mockResolvedValue([{ id: 'm', role: 'assistant', content: POLLED_ANSWER, createdAt: Date.now() }])
})

describe('cockpit chat — re-attaching to a running task', () => {
  it('keeps polling when a progress read fails transiently', async () => {
    progressFetch
      .mockRejectedValueOnce({ statusCode: 500 })
      .mockResolvedValueOnce({ state: 'completed', progress: ['denkt …'], answer: 'FERTIG' })

    const assistant = await tapChoice()

    expect(assistant.content).toBe('FERTIG')
    expect(progressFetch).toHaveBeenCalledTimes(2)
  })

  it('falls back to the messages poll as soon as the task is gone', async () => {
    progressFetch.mockRejectedValue({ statusCode: 404 })

    const assistant = await tapChoice()

    expect(progressFetch).toHaveBeenCalledTimes(1)
    expect(assistant.content).toBe(POLLED_ANSWER)
  })
})
