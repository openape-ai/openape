import { describe, expect, it } from 'vitest'
import { pumpJsonl } from '../src/pi-rpc'

describe('pumpJsonl', () => {
  it('returns one event per complete line, splitting on \\n only', () => {
    const r = pumpJsonl('', '{"type":"agent_start"}\n{"type":"agent_end"}\n')
    expect(r.events).toEqual([{ type: 'agent_start' }, { type: 'agent_end' }])
    expect(r.rest).toBe('')
  })

  it('keeps a trailing partial line in `rest` for the next chunk', () => {
    const r1 = pumpJsonl('', '{"type":"agent_start"}\n{"type":"messa')
    expect(r1.events).toEqual([{ type: 'agent_start' }])
    expect(r1.rest).toBe('{"type":"messa')

    const r2 = pumpJsonl(r1.rest, 'ge_start"}\n')
    expect(r2.events).toEqual([{ type: 'message_start' }])
    expect(r2.rest).toBe('')
  })

  it('does NOT split on Unicode separators (U+2028 / U+2029)', () => {
    // Per pi RPC spec these MUST be treated as ordinary characters inside
    // the JSON payload. Node's readline would split here — pumpJsonl must
    // not.
    const sep = '\u2028'
    const payload = `{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"line one${sep}line two"}}`
    const r = pumpJsonl('', `${payload}\n`)
    expect(r.events).toHaveLength(1)
    expect((r.events[0] as { assistantMessageEvent: { delta: string } }).assistantMessageEvent.delta).toBe(`line one${sep}line two`)
  })

  it('drops malformed lines silently rather than crashing the stream', () => {
    const r = pumpJsonl('', 'this is not json\n{"type":"agent_end"}\n')
    expect(r.events).toEqual([{ type: 'agent_end' }])
  })

  it('ignores blank lines', () => {
    const r = pumpJsonl('', '\n   \n{"type":"agent_start"}\n')
    expect(r.events).toEqual([{ type: 'agent_start' }])
  })
})
