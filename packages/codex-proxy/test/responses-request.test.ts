import { describe, expect, it } from 'vitest'
import { chatCompletionsToResponsesBody } from '../src/responses-request'

describe('chatCompletionsToResponsesBody', () => {
  it('puts the system message in instructions (not input) and maps user to input_text', () => {
    const body = chatCompletionsToResponsesBody({
      model: 'gpt-5.1-codex',
      messages: [
        { role: 'system', content: 'You are concise.' },
        { role: 'user', content: 'hi' },
      ],
    })
    expect(body.instructions).toBe('You are concise.')
    expect(body.store).toBe(false)
    expect(body.stream).toBe(true)
    expect(body.model).toBe('gpt-5.1-codex')
    expect(body.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }])
  })

  it('falls back to a default instruction when there is no system message', () => {
    const body = chatCompletionsToResponsesBody({ model: 'm', messages: [{ role: 'user', content: 'x' }] })
    expect(body.instructions).toBe('You are a helpful assistant.')
  })

  it('maps assistant tool_calls and tool results to function_call / function_call_output', () => {
    const body = chatCompletionsToResponsesBody({
      model: 'm',
      messages: [
        { role: 'user', content: 'calc 2+2' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'calc', arguments: '{"expr":"2+2"}' } }] },
        { role: 'tool', tool_call_id: 'call_x', content: '4' },
      ],
    })
    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'calc 2+2' }] },
      { type: 'function_call', call_id: 'call_x', name: 'calc', arguments: '{"expr":"2+2"}' },
      { type: 'function_call_output', call_id: 'call_x', output: '4' },
    ])
  })

  it('maps assistant text content to an output_text message item', () => {
    const body = chatCompletionsToResponsesBody({ model: 'm', messages: [{ role: 'assistant', content: 'done' }] })
    expect(body.input).toEqual([
      { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'done', annotations: [] }] },
    ])
  })

  it('flattens the Chat-Completions tool wrapper and sorts tools by name', () => {
    const body = chatCompletionsToResponsesBody({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        { type: 'function', function: { name: 'zeta', description: 'z', parameters: { type: 'object' } } },
        { type: 'function', function: { name: 'alpha', description: 'a' } },
      ],
    })
    expect(body.tools).toEqual([
      { type: 'function', name: 'alpha', description: 'a', parameters: {} },
      { type: 'function', name: 'zeta', description: 'z', parameters: { type: 'object' } },
    ])
  })
})
