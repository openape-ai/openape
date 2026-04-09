import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the modules that would touch the filesystem and the network
vi.mock('../src/shapes/adapters.js', () => ({
  tryLoadAdapter: vi.fn(),
  loadAdapter: vi.fn(),
}))
vi.mock('../src/shapes/registry.js', () => ({
  fetchRegistry: vi.fn(),
  findAdapter: vi.fn(),
}))
vi.mock('../src/shapes/installer.js', () => ({
  installAdapter: vi.fn(),
}))
vi.mock('../src/shapes/audit.js', () => ({
  appendAuditLog: vi.fn(),
}))

describe('loadOrInstallAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns the local adapter when it is already installed', async () => {
    const { tryLoadAdapter } = await import('../src/shapes/adapters.js')
    const { loadOrInstallAdapter } = await import('../src/shapes/shell-parser.js')

    const fakeAdapter = {
      adapter: { cli: { id: 'rm', executable: 'rm', audience: 'shapes' }, operations: [], schema: 'openape-shapes/v1' },
      source: '/home/user/.openape/shapes/adapters/rm.toml',
      digest: 'sha256:abc',
    }
    vi.mocked(tryLoadAdapter).mockReturnValueOnce(fakeAdapter as any)

    const result = await loadOrInstallAdapter('rm')
    expect(result).toBe(fakeAdapter)
    expect(tryLoadAdapter).toHaveBeenCalledWith('rm')
  })

  it('fetches registry, installs, and loads when adapter is missing locally', async () => {
    const { tryLoadAdapter } = await import('../src/shapes/adapters.js')
    const { fetchRegistry, findAdapter } = await import('../src/shapes/registry.js')
    const { installAdapter } = await import('../src/shapes/installer.js')
    const { appendAuditLog } = await import('../src/shapes/audit.js')
    const { loadOrInstallAdapter } = await import('../src/shapes/shell-parser.js')

    const installedAdapter = {
      adapter: { cli: { id: 'rm', executable: 'rm' }, operations: [], schema: 'openape-shapes/v1' },
      source: '/home/user/.openape/shapes/adapters/rm.toml',
      digest: 'sha256:abc',
    }
    const fakeEntry = {
      id: 'rm',
      name: 'rm',
      description: 'remove',
      category: 'core',
      tags: [],
      author: 'openape',
      executable: 'rm',
      min_shapes_version: 'v1',
      digest: 'sha256:abc',
      download_url: 'https://example.com/rm.toml',
    }
    const fakeIndex = { adapters: [fakeEntry] }

    vi.mocked(tryLoadAdapter)
      .mockReturnValueOnce(null) // first call: not installed
      .mockReturnValueOnce(installedAdapter as any) // after install: loaded
    vi.mocked(fetchRegistry).mockResolvedValueOnce(fakeIndex as any)
    vi.mocked(findAdapter).mockReturnValueOnce(fakeEntry as any)
    vi.mocked(installAdapter).mockResolvedValueOnce({ id: 'rm', path: '/tmp/rm.toml', digest: 'sha256:abc', updated: false } as any)

    const result = await loadOrInstallAdapter('rm')

    expect(result).toBe(installedAdapter)
    expect(fetchRegistry).toHaveBeenCalledOnce()
    expect(findAdapter).toHaveBeenCalledWith(fakeIndex, 'rm')
    expect(installAdapter).toHaveBeenCalledWith(fakeEntry, { local: false })
    expect(appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'adapter-auto-install',
      cli_id: 'rm',
      digest: 'sha256:abc',
      source: 'ape-shell',
    }))
    expect(tryLoadAdapter).toHaveBeenCalledTimes(2)
  })

  it('returns null when the executable is not in the registry', async () => {
    const { tryLoadAdapter } = await import('../src/shapes/adapters.js')
    const { fetchRegistry, findAdapter } = await import('../src/shapes/registry.js')
    const { installAdapter } = await import('../src/shapes/installer.js')
    const { loadOrInstallAdapter } = await import('../src/shapes/shell-parser.js')

    vi.mocked(tryLoadAdapter).mockReturnValueOnce(null)
    vi.mocked(fetchRegistry).mockResolvedValueOnce({ adapters: [] } as any)
    vi.mocked(findAdapter).mockReturnValueOnce(undefined)

    const result = await loadOrInstallAdapter('nonsense-binary')
    expect(result).toBeNull()
    expect(installAdapter).not.toHaveBeenCalled()
  })

  it('returns null when fetchRegistry throws (offline)', async () => {
    const { tryLoadAdapter } = await import('../src/shapes/adapters.js')
    const { fetchRegistry } = await import('../src/shapes/registry.js')
    const { loadOrInstallAdapter } = await import('../src/shapes/shell-parser.js')

    vi.mocked(tryLoadAdapter).mockReturnValueOnce(null)
    vi.mocked(fetchRegistry).mockRejectedValueOnce(new Error('network down'))

    const result = await loadOrInstallAdapter('rm')
    expect(result).toBeNull()
  })

  it('returns null when installAdapter throws', async () => {
    const { tryLoadAdapter } = await import('../src/shapes/adapters.js')
    const { fetchRegistry, findAdapter } = await import('../src/shapes/registry.js')
    const { installAdapter } = await import('../src/shapes/installer.js')
    const { loadOrInstallAdapter } = await import('../src/shapes/shell-parser.js')

    const fakeEntry = {
      id: 'rm',
      digest: 'sha256:abc',
      download_url: 'https://example.com/rm.toml',
    }
    vi.mocked(tryLoadAdapter).mockReturnValueOnce(null)
    vi.mocked(fetchRegistry).mockResolvedValueOnce({ adapters: [fakeEntry] } as any)
    vi.mocked(findAdapter).mockReturnValueOnce(fakeEntry as any)
    vi.mocked(installAdapter).mockRejectedValueOnce(new Error('digest mismatch'))

    const result = await loadOrInstallAdapter('rm')
    expect(result).toBeNull()
  })
})
