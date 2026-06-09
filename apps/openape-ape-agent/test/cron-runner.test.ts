import { describe, expect, it } from 'vitest'
import { shouldReportCommandRun } from '../src/cron-runner'

describe('shouldReportCommandRun', () => {
  it('skips the DM for a silent successful run (the once-a-minute service poll)', () => {
    expect(shouldReportCommandRun(0, '', '')).toBe(false)
    expect(shouldReportCommandRun(0, '   ', '\n')).toBe(false)
  })

  it('reports any non-zero exit even with no output', () => {
    expect(shouldReportCommandRun(1, '', '')).toBe(true)
  })

  it('reports a successful run that produced output on either stream', () => {
    expect(shouldReportCommandRun(0, 'handled 3 tasks', '')).toBe(true)
    expect(shouldReportCommandRun(0, '', '[serve] queue unreachable')).toBe(true)
  })
})
