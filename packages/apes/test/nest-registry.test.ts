import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn(() => false) }
})

afterEach(() => {
  vi.resetAllMocks()
  delete process.env.OPENAPE_NEST_REGISTRY_PATH
})

describe('resolveRegistryPath', () => {
  it('honours OPENAPE_NEST_REGISTRY_PATH above all else', async () => {
    // This override is the single source of truth the nest container
    // sets so the writer (apes-cli) and reader (nest daemon) agree.
    process.env.OPENAPE_NEST_REGISTRY_PATH = '/var/lib/openape/nest/agents.json'
    const { resolveRegistryPath } = await import('../src/lib/nest-registry.js')
    expect(resolveRegistryPath()).toBe('/var/lib/openape/nest/agents.json')
  })

  it('falls back to the per-user location when nothing is set or present', async () => {
    const { resolveRegistryPath } = await import('../src/lib/nest-registry.js')
    expect(resolveRegistryPath()).toMatch(/\.openape\/nest\/agents\.json$/)
  })
})
