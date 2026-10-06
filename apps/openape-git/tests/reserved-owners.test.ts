import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isValidOwner } from '../server/utils/git-access'

const PAGES_DIR = fileURLToPath(new URL('../app/pages', import.meta.url))

// Segments that never reach the page router but still sit at the root of the
// URL space. `_nuxt` and `.well-known` are excluded on purpose: the owner
// pattern rejects a leading underscore and any dot, so they cannot collide.
const INFRASTRUCTURE_SEGMENTS = ['api']

function topLevelPageSegments(): string[] {
  return readdirSync(PAGES_DIR, { withFileTypes: true })
    .map(entry => entry.name.replace(/\.vue$/, ''))
    .filter(name => name !== 'index' && !name.startsWith('['))
}

describe('reserved owners', () => {
  // Owners live at the root of the URL space, so any literal top-level route
  // is a name an owner could shadow. This derives the list from the pages
  // directory rather than repeating it: add a top-level page without
  // reserving its name and this test fails instead of the route silently
  // becoming unreachable for whoever registers that owner first.
  it('rejects every top-level route name that could pass as an owner', () => {
    const candidates = [...topLevelPageSegments(), ...INFRASTRUCTURE_SEGMENTS]
    for (const segment of candidates)
      expect(isValidOwner(segment), `"${segment}" must be reserved`).toBe(false)
  })

  it('still accepts an ordinary owner', () => {
    expect(isValidOwner('patrick')).toBe(true)
    expect(isValidOwner('delta-mind')).toBe(true)
  })
})
