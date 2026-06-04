import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// runLoop is the LLM driver; we control it to simulate a hung backend
// (never resolves) vs a normal streaming turn.
const runLoopMock = vi.fn()
vi.mock('@openape/apes', () => ({
  runLoop: (...args: unknown[]) => runLoopMock(...args),
  taskTools: () => [],
}))

const { ThreadSession } = await import('../src/thread-session')

function makeDeps() {
  const postMessage = vi.fn(async () => ({ id: 'ph1' }))
  const patchMessage = vi.fn(async () => {})
  const listMessages = vi.fn(async () => [])
  const deps = {
    roomId: 'room1',
    threadId: 'thread-abcdef12',
    chat: { postMessage, patchMessage, listMessages },
    runtimeConfig: {} as any,
    resolveConfig: () => ({ systemPrompt: 'sys', tools: [] as string[] }),
    selfEmail: 'agent@id.openape.ai',
    maxSteps: 5,
    log: () => {},
  }
  return { deps, postMessage, patchMessage, listMessages }
}

// The failure surfaces as the final patch that both carries the error
// body AND flips streaming:false (clearing the typing indicator). An
// earlier throttle-flush patch may carry the body without the flag, so
// match on both to assert the turn actually ended.
function findFailPatch(patchMessage: ReturnType<typeof vi.fn>) {
  return patchMessage.mock.calls.find(
    c => typeof c[1]?.body === 'string'
      && /no response from the model backend/i.test(c[1].body)
      && c[1]?.streaming === false,
  )
}

// startTurn awaits the placeholder post + history backfill before it
// arms the watchdog timer; flush those microtasks so the timer exists
// before we advance the fake clock.
async function flushMicrotasks() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

describe('ThreadSession — no-activity watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    runLoopMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails the turn visibly when the backend produces no first token', async () => {
    runLoopMock.mockReturnValue(new Promise(() => {})) // hung backend — never resolves
    const { deps, patchMessage } = makeDeps()
    const session = new ThreadSession(deps as any)

    session.enqueue('Wer bist du?', 'msg1')
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(61_000)

    expect(findFailPatch(patchMessage)).toBeTruthy() // error surfaced + typing cleared
  })

  it('does not fire the watchdog once the model starts streaming', async () => {
    runLoopMock.mockImplementation(async ({ handlers }: any) => {
      handlers.onTextDelta('Hallo')
      return { status: 'ok', finalMessage: 'Hallo' }
    })
    const { deps, patchMessage } = makeDeps()
    const session = new ThreadSession(deps as any)

    session.enqueue('hi', 'msg1')
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(61_000)

    expect(findFailPatch(patchMessage)).toBeFalsy()
    const ended = patchMessage.mock.calls.find(c => c[1]?.body === 'Hallo' && c[1]?.streaming === false)
    expect(ended).toBeTruthy()
  })
})
