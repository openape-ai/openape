import { describe, expect, it } from 'vitest'
import { getTemplate, PLAN_TEMPLATES } from '@openape/ape-plans/templates'
import { renderMarkdown } from '../app/utils/markdown'

// The CLI (`ape-plans templates` / `new --template`) and the web editor share
// this one source, so assert its shape here.
describe('plan templates', () => {
  it('ships at least the blank/feature/bugfix trio', () => {
    const names = PLAN_TEMPLATES.map(t => t.name)
    expect(names).toEqual(expect.arrayContaining(['blank', 'feature', 'bugfix']))
    expect(PLAN_TEMPLATES.length).toBeGreaterThanOrEqual(3)
  })

  it('feature template carries the plan sections', () => {
    const body = getTemplate('feature')?.body ?? ''
    expect(body).toContain('## Goal')
    expect(body).toContain('## Milestones')
    expect(body).toContain('Acceptance')
  })

  it('every template body renders inert (no payload survives)', () => {
    for (const t of PLAN_TEMPLATES) {
      const out = renderMarkdown(t.body)
      expect(out).not.toContain('<script')
      expect(out).not.toContain('onerror')
    }
  })
})
