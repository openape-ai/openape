import { describe, expect, it } from 'vitest'
import { parseSSEEvents } from '../src/sse'

async function* feed(...parts: string[]): AsyncGenerator<string> {
  for (const p of parts) yield p
}

describe('parseSSEEvents', () => {
  it('parses data frames even when split across chunks', async () => {
    const events: unknown[] = []
    for await (const e of parseSSEEvents(feed('data: {"type":"a"}\n', '\ndata: {"type":"b"}\n\n')))
      events.push(e)
    expect(events).toEqual([{ type: 'a' }, { type: 'b' }])
  })

  it('skips [DONE] and empty data lines', async () => {
    const events: unknown[] = []
    for await (const e of parseSSEEvents(feed('data: {"type":"x"}\n\n', 'data: [DONE]\n\n')))
      events.push(e)
    expect(events).toEqual([{ type: 'x' }])
  })

  it('throws on a malformed JSON frame', async () => {
    await expect(async () => {
      for await (const _ of parseSSEEvents(feed('data: {not json}\n\n'))) { /* drain */ }
    }).rejects.toThrow()
  })
})
