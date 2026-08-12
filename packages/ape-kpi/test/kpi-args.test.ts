import { describe, expect, it } from 'vitest'
import { parsePushArgs } from '../src/kpi-args.ts'

describe('parsePushArgs', () => {
  it('builds a minimal body without optional fields', () => {
    const r = parsePushArgs({ key: 'demo.test', value: '1' })
    expect(r).toEqual({ ok: true, body: { key: 'demo.test', value: 1 } })
  })

  it('carries scope, unit and detail through', () => {
    const r = parsePushArgs({ key: 'k', value: '2.5', scope: 'delta-mind/mail', unit: 'mails', detail: '# hi' })
    expect(r.ok).toBe(true)
    if (r.ok)
      expect(r.body).toEqual({ key: 'k', value: 2.5, scope: 'delta-mind/mail', unit: 'mails', detail: '# hi' })
  })

  it.each([
    [{ value: '1' }, 'key required'],
    [{ key: 'k' }, 'finite number'],
    [{ key: 'k', value: 'zwei' }, 'finite number'],
    [{ key: 'k', value: '' }, 'finite number'],
    [{ key: 'k', value: 'Infinity' }, 'finite number'],
  ])('rejects %j', (args, message) => {
    const r = parsePushArgs(args)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toContain(message)
  })
})
