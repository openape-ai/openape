import type { ChatCompletionChunk, ChunkChoiceDelta } from '../src/types'
import { describe, expect, it } from 'vitest'
import { collectChatCompletion } from '../src/proxy'

function chunkFeed(...choices: Array<{ delta: ChunkChoiceDelta, finish_reason: string | null }>): AsyncGenerator<ChatCompletionChunk> {
  return (async function* () {
    for (const c of choices)
      yield { id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: c.delta, finish_reason: c.finish_reason }] }
  })()
}

describe('collectChatCompletion', () => {
  it('aggregates text deltas into a single chat.completion', async () => {
    const out = await collectChatCompletion(chunkFeed(
      { delta: { role: 'assistant' }, finish_reason: null },
      { delta: { content: 'Hello' }, finish_reason: null },
      { delta: { content: ' world' }, finish_reason: null },
      { delta: {}, finish_reason: 'stop' },
    ), { id: 'r1', model: 'gpt-5.5', created: 7 })

    expect(out).toEqual({
      id: 'r1',
      object: 'chat.completion',
      created: 7,
      model: 'gpt-5.5',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello world' }, finish_reason: 'stop' }],
    })
  })

  it('assembles tool_call deltas across chunks (content null)', async () => {
    const out = await collectChatCompletion(chunkFeed(
      { delta: { role: 'assistant' }, finish_reason: null },
      { delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '' } }] }, finish_reason: null },
      { delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }, finish_reason: null },
      { delta: { tool_calls: [{ index: 0, function: { arguments: '"Vienna"}' } }] }, finish_reason: null },
      { delta: {}, finish_reason: 'tool_calls' },
    ), { id: 'r2', model: 'm', created: 1 })

    expect(out.choices[0]!.message).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Vienna"}' } }],
    })
    expect(out.choices[0]!.finish_reason).toBe('tool_calls')
  })

  it('defaults finish_reason to stop when the stream omits it', async () => {
    const out = await collectChatCompletion(chunkFeed(
      { delta: { content: 'hi' }, finish_reason: null },
    ), { id: 'r3', model: 'm', created: 1 })
    expect(out.choices[0]!.finish_reason).toBe('stop')
    expect(out.choices[0]!.message).toEqual({ role: 'assistant', content: 'hi' })
  })
})
