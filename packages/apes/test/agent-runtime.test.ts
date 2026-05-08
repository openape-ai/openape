import { describe, expect, it, vi } from 'vitest'
import { runLoop, RpcSessionMap  } from '../src/lib/agent-runtime'
import type { RuntimeConfig } from '../src/lib/agent-runtime'
import type { ToolDefinition } from '../src/lib/agent-tools'

const config: RuntimeConfig = {
  apiBase: 'http://test.local/v1',
  apiKey: 'sk-test',
  model: 'test-model',
}

function chatResponse(message: { content?: string | null, tool_calls?: unknown[] }): Response {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('runLoop — happy path', () => {
  it('returns ok when the model replies with content and no tool_calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse({ content: 'hello' }))
    const result = await runLoop({
      config,
      systemPrompt: 'reply hello',
      userMessage: 'go',
      tools: [],
      maxSteps: 5,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    expect(result.status).toBe('ok')
    expect(result.finalMessage).toBe('hello')
    expect(result.stepCount).toBe(1)
    expect(result.trace).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('runLoop — tool calling', () => {
  const echoTool: ToolDefinition = {
    name: 'echo',
    description: 'echo args',
    parameters: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
    execute: async args => `echoed: ${(args as { msg: string }).msg}`,
  }

  it('executes tool calls and feeds results back to the model', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(chatResponse({
        content: null,
        tool_calls: [{
          id: 'tc1',
          type: 'function',
          function: { name: 'echo', arguments: '{"msg":"hi"}' },
        }],
      }))
      .mockResolvedValueOnce(chatResponse({ content: 'tool returned echoed: hi' }))

    const result = await runLoop({
      config,
      systemPrompt: 'use echo',
      userMessage: 'go',
      tools: [echoTool],
      maxSteps: 5,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    expect(result.status).toBe('ok')
    expect(result.finalMessage).toBe('tool returned echoed: hi')
    expect(result.stepCount).toBe(2)
    expect(result.trace.map(t => t.type)).toEqual(['assistant', 'tool_call', 'tool_result', 'assistant'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('captures tool errors as tool_error trace and continues', async () => {
    const failTool: ToolDefinition = {
      name: 'fail',
      description: 'always fails',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => { throw new Error('boom') },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(chatResponse({
        content: null,
        tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'fail', arguments: '{}' } }],
      }))
      .mockResolvedValueOnce(chatResponse({ content: 'okay, gave up after the failure' }))

    const result = await runLoop({
      config,
      systemPrompt: 'use fail',
      userMessage: 'go',
      tools: [failTool],
      maxSteps: 5,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    expect(result.status).toBe('ok')
    const errorEntry = result.trace.find(t => t.type === 'tool_error')
    expect(errorEntry?.preview).toContain('boom')
  })

  it('errors out when max_steps is reached without a no-tool-calls reply', async () => {
    const echoTool: ToolDefinition = {
      name: 'echo',
      description: 'echo',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => 'x',
    }
    // Each call returns a fresh Response — mockResolvedValue would
    // hand the same instance back and Body becomes unusable on the
    // second .json() read.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(chatResponse({
      content: null,
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'echo', arguments: '{}' } }],
    })))
    const result = await runLoop({
      config,
      systemPrompt: 'loop forever',
      userMessage: 'go',
      tools: [echoTool],
      maxSteps: 3,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    expect(result.status).toBe('error')
    expect(result.finalMessage).toContain('max_steps (3)')
    expect(result.stepCount).toBe(3)
  })
})

describe('runLoop — LiteLLM error', () => {
  it('throws on non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('over quota', { status: 429 }))
    await expect(runLoop({
      config,
      systemPrompt: 's',
      userMessage: 'u',
      tools: [],
      maxSteps: 1,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow(/LiteLLM 429/)
  })
})

describe('runLoop — streaming handlers', () => {
  it('fires onTextDelta for assistant content + onToolCall/onToolResult around tool ops', async () => {
    const echoTool: ToolDefinition = {
      name: 'echo',
      description: '',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => 'x',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(chatResponse({
        content: null,
        tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'echo', arguments: '{}' } }],
      }))
      .mockResolvedValueOnce(chatResponse({ content: 'final' }))

    const events: string[] = []
    await runLoop({
      config,
      systemPrompt: 's',
      userMessage: 'u',
      tools: [echoTool],
      maxSteps: 5,
      fetchImpl: fetchMock as unknown as typeof fetch,
      handlers: {
        onTextDelta: () => events.push('text_delta'),
        onToolCall: () => events.push('tool_call'),
        onToolResult: () => events.push('tool_result'),
        onDone: () => events.push('done'),
      },
    })
    expect(events).toEqual(['tool_call', 'tool_result', 'text_delta', 'done'])
  })
})

describe('RpcSessionMap', () => {
  it('returns undefined for unknown sessions', () => {
    const m = new RpcSessionMap()
    expect(m.get('nope')).toBeUndefined()
  })

  it('puts and gets, updating lastTouched', () => {
    const m = new RpcSessionMap()
    m.put('s1', { messages: [], systemPrompt: 's', tools: [], maxSteps: 5, lastTouched: 0 })
    expect(m.size()).toBe(1)
    expect(m.get('s1')).toBeDefined()
  })

  it('evictStale drops sessions older than the TTL', () => {
    const m = new RpcSessionMap()
    m.put('s1', { messages: [], systemPrompt: 's', tools: [], maxSteps: 5, lastTouched: 0 })
    // Force lastTouched into the past — past constructor logic stamps
    // it to now, so we have to mutate via re-put.
    const session = m.get('s1')!
    session.lastTouched = Date.now() - 2 * 60 * 60 * 1000 // 2h ago
    m.evictStale()
    expect(m.size()).toBe(0)
  })
})
