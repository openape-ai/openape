import type { WorkerDeps } from '../src/service-bridge'
import { describe, expect, it, vi } from 'vitest'
import { pollOnce } from '../src/service-bridge'

interface ResolveCall { id: string, state: string, artifact?: { parts: Array<{ kind: string, text?: string }> } }

function task(spec: unknown) {
  return {
    kind: 'task',
    id: 'task-1',
    contextId: 'ctx-1',
    status: { state: 'working' },
    artifacts: [],
    history: [{ kind: 'message', messageId: 'm1', role: 'user', parts: [{ kind: 'data', data: spec }] }],
    metadata: {},
  }
}

function makeDeps(over: { task?: unknown, runLoopImpl?: WorkerDeps['runLoopImpl'] }) {
  const resolveCalls: ResolveCall[] = []
  const fetchImpl = vi.fn(async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith('/api/agent/tasks/next'))
      return { ok: true, status: 200, json: async () => ({ task: over.task ?? null }) }
    if (String(url).endsWith('/api/agent/tasks/resolve')) {
      resolveCalls.push(JSON.parse(init?.body ?? '{}') as ResolveCall)
      return { ok: true, status: 200, json: async () => ({ task: null }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  const deps: WorkerDeps = {
    spBaseUrl: 'https://sp.test',
    bearer: async () => 'Bearer T',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    runLoopImpl: over.runLoopImpl ?? (async () => ({ status: 'ok', finalMessage: 'RESULT', stepCount: 1, trace: [] })),
    config: { apiBase: 'http://127.0.0.1:4001/v1', apiKey: 'k', model: 'gpt-5.5' },
    maxSteps: 10,
    log: () => {},
  }
  return { deps, resolveCalls }
}

describe('pollOnce', () => {
  it('is idle when the queue is empty', async () => {
    const { deps } = makeDeps({ task: null })
    expect(await pollOnce(deps)).toBe('idle')
  })

  it('runs a task through runLoop and resolves completed with the result', async () => {
    const runLoopImpl = vi.fn(async () => ({ status: 'ok' as const, finalMessage: 'RESULT', stepCount: 1, trace: [] }))
    const { deps, resolveCalls } = makeDeps({ task: task({ systemPrompt: 'sys', userMessage: 'do it' }), runLoopImpl })
    expect(await pollOnce(deps)).toBe('task')
    expect(runLoopImpl).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: 'sys', userMessage: 'do it' }))
    expect(resolveCalls).toHaveLength(1)
    expect(resolveCalls[0]!.id).toBe('task-1')
    expect(resolveCalls[0]!.state).toBe('completed')
    expect(resolveCalls[0]!.artifact?.parts[0]).toMatchObject({ kind: 'text', text: 'RESULT' })
  })

  it('resolves failed when runLoop throws', async () => {
    const runLoopImpl = vi.fn(async () => { throw new Error('LLM down') })
    const { deps, resolveCalls } = makeDeps({ task: task({ systemPrompt: 's', userMessage: 'u' }), runLoopImpl })
    expect(await pollOnce(deps)).toBe('task')
    expect(resolveCalls[0]!.state).toBe('failed')
    expect(resolveCalls[0]!.artifact?.parts[0]?.text).toContain('LLM down')
  })

  it('resolves failed when runLoop returns status error', async () => {
    const runLoopImpl = vi.fn(async () => ({ status: 'error' as const, finalMessage: 'max steps', stepCount: 10, trace: [] }))
    const { deps, resolveCalls } = makeDeps({ task: task({ systemPrompt: 's', userMessage: 'u' }), runLoopImpl })
    await pollOnce(deps)
    expect(resolveCalls[0]!.state).toBe('failed')
  })

  it('resolves failed when the task payload is malformed', async () => {
    const { deps, resolveCalls } = makeDeps({ task: task({ nope: true }) })
    await pollOnce(deps)
    expect(resolveCalls[0]!.state).toBe('failed')
    expect(resolveCalls[0]!.artifact?.parts[0]?.text).toMatch(/systemPrompt|userMessage|payload/i)
  })

  it('lets the task spec override the model', async () => {
    const runLoopImpl = vi.fn(async () => ({ status: 'ok' as const, finalMessage: 'x', stepCount: 1, trace: [] }))
    const { deps } = makeDeps({ task: task({ systemPrompt: 's', userMessage: 'u', model: 'gpt-5.4' }), runLoopImpl })
    await pollOnce(deps)
    expect(runLoopImpl).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ model: 'gpt-5.4' }) }))
  })
})
