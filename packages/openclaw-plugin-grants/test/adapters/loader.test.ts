import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverAdapters, loadAdapter, loadAdapterFromFile } from '../../src/adapters/loader.js'

const ADAPTERS_DIR = join(import.meta.dirname, '..', '..', 'adapters')

describe('loadAdapterFromFile', () => {
  it('loads gh.toml', () => {
    const loaded = loadAdapterFromFile(join(ADAPTERS_DIR, 'gh.toml'))
    expect(loaded.adapter.cli.id).toBe('gh')
    expect(loaded.adapter.cli.executable).toBe('gh')
    expect(loaded.adapter.operations.length).toBeGreaterThan(0)
    expect(loaded.digest).toMatch(/^SHA-256:/)
    expect(loaded.source).toContain('gh.toml')
  })

  it('loads az.toml', () => {
    const loaded = loadAdapterFromFile(join(ADAPTERS_DIR, 'az.toml'))
    expect(loaded.adapter.cli.id).toBe('az')
    expect(loaded.adapter.operations.length).toBeGreaterThan(0)
  })

  it('loads exo.toml', () => {
    const loaded = loadAdapterFromFile(join(ADAPTERS_DIR, 'exo.toml'))
    expect(loaded.adapter.cli.id).toBe('exo')
    expect(loaded.adapter.operations.length).toBeGreaterThan(0)
  })

  it('throws for non-existent file', () => {
    expect(() => loadAdapterFromFile('/nonexistent/path.toml')).toThrow()
  })
})

describe('loadAdapter with search paths', () => {
  it('finds bundled adapter by cli id', () => {
    // The bundled adapters should be found even without explicit paths
    // We test by pointing explicit paths to our adapters dir
    const loaded = loadAdapter('gh', { explicit: [ADAPTERS_DIR] })
    expect(loaded.adapter.cli.id).toBe('gh')
  })

  it('throws for unknown cli id', () => {
    expect(() => loadAdapter('nonexistent-cli', { explicit: ['/empty'] })).toThrow('No adapter found')
  })
})

describe('discoverAdapters', () => {
  it('discovers all bundled adapters', () => {
    const adapters = discoverAdapters({ explicit: [ADAPTERS_DIR] })
    const ids = adapters.map(a => a.adapter.cli.id).sort()
    expect(ids).toEqual(['az', 'exo', 'gh'])
  })

  it('still finds bundled adapters even with non-existent explicit path', () => {
    const adapters = discoverAdapters({ explicit: ['/nonexistent/path'] })
    // Bundled adapters are always in the search path
    expect(adapters.length).toBeGreaterThan(0)
  })

  it('each adapter has a digest', () => {
    const adapters = discoverAdapters({ explicit: [ADAPTERS_DIR] })
    for (const adapter of adapters) {
      expect(adapter.digest).toMatch(/^SHA-256:[0-9a-f]{64}$/)
    }
  })
})
