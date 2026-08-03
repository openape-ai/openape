import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ATTENTION_EVENT_TYPES, AttentionEventSchema, parseAttentionEvent } from '../src/events'

const fixturesDir = join(__dirname, '..', 'fixtures')

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'))
}

describe('fixtures', () => {
  it('has exactly one fixture per event type', () => {
    const files = readdirSync(fixturesDir).filter(f => f.endsWith('.json'))
    const expected = ATTENTION_EVENT_TYPES.map(t => `${t.replace('.', '-')}.json`).sort()
    expect(files.sort()).toEqual(expected)
  })

  it.each(ATTENTION_EVENT_TYPES)('fixture for %s parses', (type) => {
    const event = parseAttentionEvent(loadFixture(`${type.replace('.', '-')}.json`))
    expect(event.type).toBe(type)
  })
})

describe('envelope validation', () => {
  const valid = loadFixture('task-shipped.json') as Record<string, unknown>

  it('rejects unknown event types', () => {
    expect(AttentionEventSchema.safeParse({ ...valid, type: 'task.exploded' }).success).toBe(false)
  })

  it('rejects malformed ULIDs', () => {
    expect(AttentionEventSchema.safeParse({ ...valid, id: 'not-a-ulid' }).success).toBe(false)
  })

  it('rejects non-integer timestamps', () => {
    expect(AttentionEventSchema.safeParse({ ...valid, ts: 1785758183.5 }).success).toBe(false)
  })

  it('rejects empty task_ref', () => {
    expect(AttentionEventSchema.safeParse({ ...valid, task_ref: '' }).success).toBe(false)
  })

  it('rejects actor_kind outside human|agent', () => {
    expect(AttentionEventSchema.safeParse({ ...valid, actor_kind: 'bot' }).success).toBe(false)
  })

  it('rejects unknown envelope keys', () => {
    expect(AttentionEventSchema.safeParse({ ...valid, extra: true }).success).toBe(false)
  })
})

describe('payload validation', () => {
  it('rejects proof.attached with invalid kind', () => {
    const event = loadFixture('proof-attached.json') as { payload: Record<string, unknown> }
    event.payload.kind = 'video'
    expect(AttentionEventSchema.safeParse(event).success).toBe(false)
  })

  it('rejects proof.attached with non-URL', () => {
    const event = loadFixture('proof-attached.json') as { payload: Record<string, unknown> }
    event.payload.url = 'not a url'
    expect(AttentionEventSchema.safeParse(event).success).toBe(false)
  })

  it('rejects verdict.given outside merge|rework|reject', () => {
    const event = loadFixture('verdict-given.json') as { payload: Record<string, unknown> }
    event.payload.verdict = 'lgtm'
    expect(AttentionEventSchema.safeParse(event).success).toBe(false)
  })

  it('rejects negative cost amounts', () => {
    const event = loadFixture('cost-recorded.json') as { payload: Record<string, unknown> }
    event.payload.amount_eur = -1
    expect(AttentionEventSchema.safeParse(event).success).toBe(false)
  })

  it('rejects decision.requested without question', () => {
    const event = loadFixture('decision-requested.json') as { payload: Record<string, unknown> }
    delete event.payload.question
    expect(AttentionEventSchema.safeParse(event).success).toBe(false)
  })

  it('parseAttentionEvent throws on invalid input', () => {
    expect(() => parseAttentionEvent({})).toThrow()
  })
})
