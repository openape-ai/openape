import { describe, expect, it } from 'vitest'
import { streamChatCompletion } from '../src/proxy'

async function* feed(...parts: string[]): AsyncGenerator<string> {
  for (const p of parts) yield p
}

describe('streamChatCompletion', () => {
  it('translates a request and streams chat.completion deltas from a fake Codex SSE response', async () => {
    const sse = feed(
      'data: {"type":"response.output_item.added","item":{"type":"message","id":"m1"}}\n\n',
      'data: {"type":"response.output_text.delta","item_id":"m1","delta":"Hi"}\n\n',
      'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      'data: [DONE]\n\n',
    )
    const deltas: unknown[] = []
    let sentBody: unknown
    for await (const ch of streamChatCompletion(
      { model: 'm', messages: [{ role: 'user', content: 'x' }] },
      { meta: { id: 'r', model: 'm', created: 1 }, fetchResponses: async (body) => { sentBody = body; return sse } },
    )) {
      deltas.push(ch.choices[0]!.delta)
    }
    expect(deltas).toEqual([{ role: 'assistant' }, { content: 'Hi' }, {}])
    // the request was converted to a Codex Responses body
    expect(sentBody).toMatchObject({ store: false, stream: true, instructions: 'You are a helpful assistant.' })
  })
})
