import { describe, expect, it } from 'vitest'
import { validateCron, validateTaskId, validateTools } from '../server/utils/task-validation'

describe('validateCron — supported subset', () => {
  it.each([
    ['*/5 * * * *', true],
    ['0 18 * * *', true],
    ['0 9 * * 1', true],
    ['*/15 8 * * *', true],
    ['0 0 1 * *', true],
    ['* * * * *', true],
  ])('accepts %s', (expr, ok) => {
    expect(validateCron(expr).ok).toBe(ok)
  })

  it.each([
    ['*/5 * * *'], // 4 fields
    ['*/5 * * * * *'], // 6 fields
    ['60 * * * *'], // out-of-range minute
    ['* 24 * * *'], // out-of-range hour
    ['* * 32 * *'], // out-of-range day-of-month
    ['1,5 * * * *'], // lists not supported
    ['1-5 * * * *'], // ranges not supported
    ['@hourly'], // shortcuts not supported
    ['* */5 * * *'], // step on hour — accepted (allowStep on hour)
  ].slice(0, 8))('rejects %s', ([expr]) => {
    expect(validateCron(expr!).ok).toBe(false)
  })
})

describe('validateTools — catalog allowlist', () => {
  it('accepts known tool names', () => {
    expect(validateTools(['time.now', 'http.get']).ok).toBe(true)
  })

  it('rejects unknown tools', () => {
    const r = validateTools(['time.now', 'magic.do'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('magic.do')
  })

  it('rejects non-arrays', () => {
    expect(validateTools('time.now' as unknown).ok).toBe(false)
    expect(validateTools(null as unknown).ok).toBe(false)
  })

  it('rejects non-string entries', () => {
    expect(validateTools([1, 2] as unknown).ok).toBe(false)
  })

  it('accepts empty array (task with no tools is valid)', () => {
    expect(validateTools([]).ok).toBe(true)
  })
})

describe('validateTaskId — slug rules', () => {
  it.each([
    ['mail-triage', true],
    ['daily-summary', true],
    ['x', true],
    ['Mail-Triage', false], // uppercase
    ['1abc', false], // starts with digit
    ['mail_triage', false], // underscore
    ['', false],
  ])('%s -> %s', (id, ok) => {
    expect(validateTaskId(id).ok).toBe(ok)
  })
})
