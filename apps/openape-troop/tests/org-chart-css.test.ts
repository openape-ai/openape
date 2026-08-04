import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The org chart's width lives in exactly one file. A second, query-less
// `.org-tree { width: ... }` in Chart.vue once won a specificity tie against
// OrgNode.vue's phone media query (media queries do not raise specificity), so
// phones kept the desktop `max-content` width and every card grew past the
// screen. A component test cannot catch this — happy-dom computes no layout —
// so the guard is on the source: only one file may size .org-tree.
const COMPONENTS = join(import.meta.dirname, '../app/components/company')

function orgTreeWidthRules(file: string): string[] {
  const css = readFileSync(join(COMPONENTS, file), 'utf8')
  return Array.from(css.matchAll(/\.org-tree\s*(?:,[^{]*)?\{([^}]*)\}/g), m => m[1]!)
    .filter(body => /\bwidth\s*:/.test(body))
}

describe('org chart width', () => {
  it('is declared in OrgNode.vue only — both the wide and the phone rule', () => {
    expect(orgTreeWidthRules('OrgNode.vue').length).toBeGreaterThanOrEqual(2)
    expect(orgTreeWidthRules('Chart.vue')).toEqual([])
  })

  it('lets the phone layout drop max-content, so cards fit the screen', () => {
    const css = readFileSync(join(COMPONENTS, 'OrgNode.vue'), 'utf8')
    const phone = css.slice(css.indexOf('@media (max-width: 640px)'))
    expect(phone).toMatch(/\.org-tree\s*\{[^}]*width:\s*auto/)
    expect(phone).toMatch(/\.org-card\s*\{[^}]*width:\s*100%/)
  })
})
