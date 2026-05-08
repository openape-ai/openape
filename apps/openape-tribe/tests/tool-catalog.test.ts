import { describe, expect, it } from 'vitest'
import catalog from '../server/tool-catalog.json'

describe('tool catalog', () => {
  it('has the expected shape', () => {
    expect(Array.isArray(catalog.tools)).toBe(true)
    for (const tool of catalog.tools) {
      expect(typeof tool.name).toBe('string')
      expect(tool.name).toMatch(/^[a-z][a-z0-9.]+$/)
      expect(typeof tool.description).toBe('string')
      expect(['low', 'medium', 'high']).toContain(tool.risk)
    }
  })

  it('has unique tool names', () => {
    const names = catalog.tools.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('always includes time.now as the trivial smoke-test tool', () => {
    // Pin: every fresh agent should be able to validate "tool calls
    // round-trip at all" with a no-arg time.now task before owners
    // graduate to anything fancier. Don't accidentally remove it.
    expect(catalog.tools.some(t => t.name === 'time.now')).toBe(true)
  })
})
