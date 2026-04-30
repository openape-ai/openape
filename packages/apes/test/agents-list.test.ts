import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/config.js', () => ({
  loadAuth: vi.fn(() => ({ idp: 'https://id.openape.ai', email: 'patrick@hofmann.eco', access_token: 't', expires_at: 9_999_999_999 })),
  getIdpUrl: vi.fn(() => 'https://id.openape.ai'),
}))

vi.mock('../src/http.js', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('../src/lib/macos-user.js', () => ({
  isDarwin: vi.fn(() => true),
  listMacOSUserNames: vi.fn(() => new Set(['agent-a', 'patrick'])),
  readMacOSUser: vi.fn(),
  whichBinary: vi.fn(),
  isShellRegistered: vi.fn(),
}))

const TWO_AGENTS = [
  { email: 'agent-a+patrick+hofmann_eco@id.openape.ai', name: 'agent-a', owner: 'patrick@hofmann.eco', approver: 'patrick@hofmann.eco', type: 'agent', isActive: true, createdAt: 1 },
  { email: 'agent-b+patrick+hofmann_eco@id.openape.ai', name: 'agent-b', owner: 'patrick@hofmann.eco', approver: 'patrick@hofmann.eco', type: 'agent', isActive: true, createdAt: 2 },
  { email: 'old+patrick+hofmann_eco@id.openape.ai', name: 'old', owner: 'patrick@hofmann.eco', approver: 'patrick@hofmann.eco', type: 'agent', isActive: false, createdAt: 3 },
]

describe('apes agents list', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let writeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    logSpy.mockRestore()
    writeSpy.mockRestore()
    vi.resetModules()
  })

  function output(): string {
    return logSpy.mock.calls.map(c => c.join(' ')).join('\n')
  }

  it('default output hides inactive and shows OS-USER cross-reference', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce(TWO_AGENTS as any)

    const { listAgentsCommand } = await import('../src/commands/agents/list.js')
    await (listAgentsCommand as any).run({ args: {} })

    const out = output()
    expect(out).toMatch(/agent-a/)
    expect(out).toMatch(/agent-b/)
    expect(out).not.toMatch(/\bold\b/)
    expect(out).toContain('/Users/agent-a')
    expect(out).toContain('(missing)')
  })

  it('--include-inactive shows deactivated agents', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce(TWO_AGENTS as any)

    const { listAgentsCommand } = await import('../src/commands/agents/list.js')
    await (listAgentsCommand as any).run({ args: { 'include-inactive': true } })

    const out = output()
    expect(out).toMatch(/\bold\b/)
  })

  it('--json emits parseable array', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce(TWO_AGENTS as any)

    const { listAgentsCommand } = await import('../src/commands/agents/list.js')
    await (listAgentsCommand as any).run({ args: { json: true } })

    expect(writeSpy).toHaveBeenCalled()
    const out = (writeSpy.mock.calls[0]![0] as string).trim()
    const parsed = JSON.parse(out)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ name: 'agent-a', osUser: true, home: '/Users/agent-a', isActive: true })
    expect(parsed[1]).toMatchObject({ name: 'agent-b', osUser: false, home: null })
  })

  it('GETs /api/my-agents with the configured idp', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce([] as any)

    const { listAgentsCommand } = await import('../src/commands/agents/list.js')
    await (listAgentsCommand as any).run({ args: {} })

    expect(apiFetch).toHaveBeenCalledWith('/api/my-agents', { idp: 'https://id.openape.ai' })
  })
})
