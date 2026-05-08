import { describe, expect, it } from 'vitest'
import { pumpJsonl } from '../src/apes-rpc'

describe('pumpJsonl', () => {
  it('returns one event per complete line, splitting on \\n only', () => {
    const r = pumpJsonl('', '{"type":"text_delta","delta":"a"}\n{"type":"done"}\n')
    expect(r.events).toEqual([
      { type: 'text_delta', delta: 'a' },
      { type: 'done' },
    ])
    expect(r.rest).toBe('')
  })

  it('keeps a trailing partial line in `rest` for the next chunk', () => {
    const r1 = pumpJsonl('', '{"type":"text_delta","delta":"hel')
    expect(r1.events).toEqual([])
    expect(r1.rest).toBe('{"type":"text_delta","delta":"hel')

    const r2 = pumpJsonl(r1.rest, 'lo"}\n')
    expect(r2.events).toEqual([{ type: 'text_delta', delta: 'hello' }])
    expect(r2.rest).toBe('')
  })

  it('does NOT split on Unicode separators (U+2028 / U+2029)', () => {
    // A user-typed message containing a line-separator MUST flow through
    // the runtime as a single text_delta — Node's readline would split
    // here, pumpJsonl must not.
    const sep = '\u2028'
    const payload = `{"type":"text_delta","session_id":"x","delta":"line one${sep}line two"}`
    const r = pumpJsonl('', `${payload}\n`)
    expect(r.events).toHaveLength(1)
    expect((r.events[0] as { delta: string }).delta).toBe(`line one${sep}line two`)
  })

  it('drops malformed lines (e.g. stderr leak) without throwing', () => {
    const r = pumpJsonl('', 'not json\n{"type":"done"}\n')
    expect(r.events).toEqual([{ type: 'done' }])
    expect(r.rest).toBe('')
  })

  it('skips blank lines', () => {
    const r = pumpJsonl('', '\n\n{"type":"done"}\n\n')
    expect(r.events).toEqual([{ type: 'done' }])
  })
})
