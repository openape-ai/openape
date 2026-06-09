import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveRecipeDir, shouldReportCommandRun } from '../src/cron-runner'

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

describe('resolveRecipeDir', () => {
  const saved = process.env.OPENAPE_RECIPE_DEV_DIR
  afterEach(() => {
    if (saved === undefined) delete process.env.OPENAPE_RECIPE_DEV_DIR
    else process.env.OPENAPE_RECIPE_DEV_DIR = saved
  })

  it('prefers a bind-mounted dev recipe dir when OPENAPE_RECIPE_DEV_DIR is set', () => {
    process.env.OPENAPE_RECIPE_DEV_DIR = '/opt/recipe-dev'
    expect(resolveRecipeDir()).toBe('/opt/recipe-dev')
  })

  it('falls back to the synced ~/recipe when unset', () => {
    delete process.env.OPENAPE_RECIPE_DEV_DIR
    expect(resolveRecipeDir()).toBe(join(homedir(), 'recipe'))
  })
})
