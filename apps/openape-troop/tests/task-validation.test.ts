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
    ['* * */5 * *'], // step on day-of-month not supported
    ['* * * */2 *'], // step on month not supported
    ['* * * * */2'], // step on day-of-week not supported
  ])('rejects %s', ([expr]) => {
    expect(validateCron(expr!).ok).toBe(false)
  })

  it('accepts steps on minute and hour only', () => {
    expect(validateCron('* */5 * * *').ok).toBe(true)
    expect(validateCron('*/15 8 * * *').ok).toBe(true)
  })

  it('checks each numeric field boundary', () => {
    expect(validateCron('59 23 31 12 7').ok).toBe(true)
    expect(validateCron('60 23 31 12 7').ok).toBe(false)
    expect(validateCron('59 24 31 12 7').ok).toBe(false)
    expect(validateCron('59 23 32 12 7').ok).toBe(false)
    expect(validateCron('59 23 31 13 7').ok).toBe(false)
    expect(validateCron('59 23 31 12 8').ok).toBe(false)
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

  it('returns the validated catalog names unchanged', () => {
    expect(validateTools(['time.now', 'http.get'])).toEqual({ ok: true, tools: ['time.now', 'http.get'] })
  })

  it('rejects blank tool names', () => {
    const r = validateTools(['time.now', '   '])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('   ')
  })

  it('reports every unknown tool without widening the result', () => {
    const r = validateTools(['unknown.one', 'unknown.two'])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('unknown.one')
      expect(r.reason).toContain('unknown.two')
    }
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
