import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isKnownScope, scopesAreCovered, TROOP_SCOPES } from '../server/utils/scope-catalog'

const API_DIR = fileURLToPath(new URL('../server/api', import.meta.url))

/** Every handler as `METHOD /api/...`, with `[param]` normalized to `:param`. */
function actualRoutes(): Set<string> {
  const routes = new Set<string>()
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full, `${prefix}/${entry}`)
        continue
      }
      const m = /^(.*)\.(get|post|put|patch|delete)\.ts$/.exec(entry)
      if (!m) continue
      const segment = m[1] === 'index' ? '' : `/${m[1]}`
      const path = `${prefix}${segment}`.replace(/\[(\w+)\]/g, ':$1')
      routes.add(`${m[2]!.toUpperCase()} ${path}`)
    }
  }
  walk(API_DIR, '/api')
  return routes
}

describe('troop scope catalog', () => {
  it('publishes at least the spawn + destroy + read trio', () => {
    const ids = TROOP_SCOPES.map(s => s.id)
    expect(ids).toContain('troop:spawn-agent')
    expect(ids).toContain('troop:destroy-agent')
    expect(ids).toContain('troop:read-agents')
  })

  it('publishes the nest:* device-binding trio (M4δ)', () => {
    const ids = TROOP_SCOPES.map(s => s.id)
    expect(ids).toContain('nest:bind')
    expect(ids).toContain('nest:spawn-agent')
    expect(ids).toContain('nest:report-status')
  })

  it('every entry has the spec-required shape (sp-data-access §3.2)', () => {
    for (const s of TROOP_SCOPES) {
      expect(typeof s.id).toBe('string')
      expect(s.id).toMatch(/^(?:troop|nest):[a-z-]+$/)
      expect(typeof s.description).toBe('string')
      expect(s.description.length).toBeGreaterThan(10)
      expect(Array.isArray(s.grants)).toBe(true)
    }
  })

  it('isKnownScope rejects unknown ids', () => {
    expect(isKnownScope('troop:spawn-agent')).toBe(true)
    expect(isKnownScope('troop:not-a-thing')).toBe(false)
    expect(isKnownScope('chat:read')).toBe(false)
    expect(isKnownScope('')).toBe(false)
  })

  // The grants are enforced (#1038), so a typo or a renamed route silently
  // turns into a 403 for every delegate holding that scope.
  it('every granted route exists as a handler', () => {
    const actual = actualRoutes()
    const missing = TROOP_SCOPES.flatMap(s =>
      s.grants.filter(g => !actual.has(g)).map(g => `${s.id}: ${g}`))
    expect(missing).toEqual([])
  })

  it('scopesAreCovered returns the full list of unknowns', () => {
    expect(scopesAreCovered(['troop:spawn-agent'])).toEqual({ ok: true })
    expect(scopesAreCovered([])).toEqual({ ok: true })
    expect(scopesAreCovered(['troop:spawn-agent', 'troop:made-up', 'chat:read']))
      .toEqual({ ok: false, unknown: ['troop:made-up', 'chat:read'] })
  })
})
