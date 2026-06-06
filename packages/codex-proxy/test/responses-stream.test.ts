import { describe, expect, it } from 'vitest'
import { ResponsesStreamConverter } from '../src/responses-stream'

function conv() {
  return new ResponsesStreamConverter({ id: 'run_1', model: 'm', created: 1700000000 })
}
const base = { id: 'run_1', object: 'chat.completion.chunk' as const, created: 1700000000, model: 'm' }

describe('ResponsesStreamConverter', () => {
  it('streams text: role chunk, then content deltas, then finish=stop', () => {
    const c = conv()
    expect(c.push({ type: 'response.output_item.added', item: { type: 'message', id: 'msg_1' } })).toEqual([
      { ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
    ])
    expect(c.push({ type: 'response.output_text.delta', item_id: 'msg_1', delta: 'Hi' })).toEqual([
      { ...base, choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }] },
    ])
    expect(c.push({ type: 'response.completed', response: { status: 'completed' } })).toEqual([
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ])
  })

  it('sends the assistant role chunk only once', () => {
    const c = conv()
    c.push({ type: 'response.output_item.added', item: { type: 'message', id: 'm1' } })
    const second = c.push({ type: 'response.output_text.delta', item_id: 'm1', delta: 'a' })
    expect(second.some(ch => ch.choices[0]!.delta.role)).toBe(false)
  })

  it('streams a tool call: role + open chunk, arg deltas correlated by item_id, finish=tool_calls', () => {
    const c = conv()
    const open = c.push({ type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_1', call_id: 'call_x', name: 'calc' } })
    expect(open[0]!.choices[0]!.delta).toEqual({ role: 'assistant' })
    expect(open[1]!.choices[0]!.delta).toEqual({ tool_calls: [{ index: 0, id: 'call_x', type: 'function', function: { name: 'calc', arguments: '' } }] })
    expect(c.push({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"expr":"2+2"}' })).toEqual([
      { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"expr":"2+2"}' } }] }, finish_reason: null }] },
    ])
    expect(c.push({ type: 'response.completed', response: { status: 'completed' } })[0]!.choices[0]!.finish_reason).toBe('tool_calls')
  })

  it('maps an incomplete response to finish_reason=length', () => {
    const c = conv()
    c.push({ type: 'response.output_item.added', item: { type: 'message', id: 'm1' } })
    expect(c.push({ type: 'response.completed', response: { status: 'incomplete' } })[0]!.choices[0]!.finish_reason).toBe('length')
  })

  it('throws loudly on a stream error/failed event', () => {
    const c = conv()
    expect(() => c.push({ type: 'response.failed', response: { status: 'failed', error: { message: 'boom' } } })).toThrow(/error|boom|failed/i)
  })
})
