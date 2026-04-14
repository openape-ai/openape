import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the config + http modules so we can drive apiFetch responses
// synthetically and capture console output without touching the network.
vi.mock('../src/config.js', () => ({
  getIdpUrl: vi.fn(() => 'http://idp.test'),
}))
vi.mock('../src/http.js', () => ({
  apiFetch: vi.fn(),
  getGrantsEndpoint: vi.fn(async () => 'http://idp.test/api/grants'),
}))

// Deterministic timestamps for every test so the ISO comparisons don't drift
// across timezones or clock values. Real grants on id.openape.at use unix
// seconds; these are intentionally distinctive so test output stays readable.
const CREATED_AT = 1776154258 // 2026-04-14T08:10:58.000Z
const DECIDED_AT = 1776154298 // 2026-04-14T08:11:38.000Z
const USED_AT = 1776154311 // 2026-04-14T08:11:51.000Z
const EXPIRES_AT = 1776240658 // 2026-04-15T08:10:58.000Z

function fakeApprovedShapesGrant(overrides: Record<string, any> = {}): any {
  return {
    id: 'grant-xyz',
    type: null,
    status: 'approved',
    request: {
      requester: 'alice@example.com',
      target_host: 'workstation.local',
      audience: 'shapes',
      grant_type: 'once',
      command: ['whoami'],
      reason: 'ape-shell: Show current username',
      authorization_details: [
        { type: 'openape_cli', display: 'Show current username', permission: 'whoami.system[identity=current]#read' },
      ],
    },
    created_at: CREATED_AT,
    decided_at: DECIDED_AT,
    decided_by: 'bob@example.com',
    used_at: USED_AT,
    ...overrides,
  }
}

describe('apes grants status', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    vi.resetModules()
  })

  // Helper: join all captured stdout into one blob for easy regex matching.
  function collected(): string {
    return logSpy.mock.calls.map(args => args.join(' ')).join('\n')
  }

  it('prints all expected fields for an approved shapes grant', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce(fakeApprovedShapesGrant() as any)

    const { statusCommand } = await import('../src/commands/grants/status.js')
    await (statusCommand as any).run({ args: { id: 'grant-xyz', json: false } })

    const out = collected()
    expect(out).toContain('Grant:     grant-xyz')
    expect(out).toContain('Status:    approved')
    expect(out).toContain('Audience:  shapes')
    expect(out).toContain('Requester: alice@example.com')
    expect(out).toContain('Host:      workstation.local')
    expect(out).toContain('Command:   whoami')
    expect(out).toContain('Approval:  once')
    expect(out).toContain('Reason:    ape-shell: Show current username')
    expect(out).toContain('Decided by: bob@example.com')
  })

  it('formats all timestamps as ISO-8601, not raw unix numbers', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce(fakeApprovedShapesGrant({ expires_at: EXPIRES_AT }) as any)

    const { statusCommand } = await import('../src/commands/grants/status.js')
    await (statusCommand as any).run({ args: { id: 'grant-xyz', json: false } })

    const out = collected()
    expect(out).toContain('Created:   2026-04-14T08:10:58.000Z')
    expect(out).toContain('Decided at: 2026-04-14T08:11:38.000Z')
    expect(out).toContain('Used at:   2026-04-14T08:11:51.000Z')
    expect(out).toContain('Expires:   2026-04-15T08:10:58.000Z')
    // Assert that no raw unix timestamp leaked through
    expect(out).not.toMatch(/\b1776154258\b/)
    expect(out).not.toMatch(/\b1776154298\b/)
  })

  it('does not print deprecated Type / Owner / Approver lines', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce(fakeApprovedShapesGrant() as any)

    const { statusCommand } = await import('../src/commands/grants/status.js')
    await (statusCommand as any).run({ args: { id: 'grant-xyz', json: false } })

    const out = collected()
    // Type is always null on current API — no point printing it
    expect(out).not.toMatch(/^Type:/m)
    // Owner was never a top-level field — old code just printed "undefined"
    expect(out).not.toMatch(/^Owner:/m)
    // Approver doesn't exist; we use Decided by instead
    expect(out).not.toMatch(/^Approver:/m)
    // And definitely no stringified undefined
    expect(out).not.toContain('undefined')
    expect(out).not.toContain('null')
  })

  it('omits optional fields that are missing from the API response', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce({
      id: 'grant-min',
      status: 'pending',
      request: {
        requester: 'alice@example.com',
        audience: 'shapes',
        command: ['ls'],
      },
      created_at: CREATED_AT,
    } as any)

    const { statusCommand } = await import('../src/commands/grants/status.js')
    await (statusCommand as any).run({ args: { id: 'grant-min', json: false } })

    const out = collected()
    expect(out).toContain('Grant:     grant-min')
    expect(out).toContain('Status:    pending')
    expect(out).toContain('Audience:  shapes')
    expect(out).toContain('Requester: alice@example.com')
    expect(out).toContain('Command:   ls')
    expect(out).toContain('Created:   2026-04-14T08:10:58.000Z')
    // Should NOT print any of the decided/used/expires lines when absent
    expect(out).not.toMatch(/^Decided by:/m)
    expect(out).not.toMatch(/^Decided at:/m)
    expect(out).not.toMatch(/^Used at:/m)
    expect(out).not.toMatch(/^Expires:/m)
    expect(out).not.toMatch(/^Host:/m)
    expect(out).not.toMatch(/^Approval:/m)
    expect(out).not.toMatch(/^Reason:/m)
  })

  it('JSON mode emits the raw API payload untouched', async () => {
    const { apiFetch } = await import('../src/http.js')
    const grant = fakeApprovedShapesGrant()
    vi.mocked(apiFetch).mockResolvedValueOnce(grant as any)

    const { statusCommand } = await import('../src/commands/grants/status.js')
    await (statusCommand as any).run({ args: { id: 'grant-xyz', json: true } })

    expect(logSpy).toHaveBeenCalledTimes(1)
    const jsonArg = logSpy.mock.calls[0]![0] as string
    const parsed = JSON.parse(jsonArg)
    expect(parsed.id).toBe('grant-xyz')
    expect(parsed.status).toBe('approved')
    expect(parsed.request.requester).toBe('alice@example.com')
    // JSON mode keeps unix timestamps — that's correct, consumers parse them
    expect(parsed.created_at).toBe(CREATED_AT)
    expect(parsed.decided_at).toBe(DECIDED_AT)
  })

  it('handles an ape-shell session grant shape', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce({
      id: 'sess-1',
      status: 'approved',
      request: {
        requester: 'alice@example.com',
        target_host: 'laptop.local',
        audience: 'ape-shell',
        grant_type: 'once',
        command: ['bash', '-c', 'curl example.com | head -5'],
        reason: 'Shell session: curl example.com | head -5',
      },
      created_at: CREATED_AT,
      decided_at: DECIDED_AT,
      decided_by: 'bob@example.com',
    } as any)

    const { statusCommand } = await import('../src/commands/grants/status.js')
    await (statusCommand as any).run({ args: { id: 'sess-1', json: false } })

    const out = collected()
    expect(out).toContain('Audience:  ape-shell')
    expect(out).toContain('Host:      laptop.local')
    expect(out).toContain('Command:   bash -c curl example.com | head -5')
    expect(out).toContain('Reason:    Shell session: curl example.com | head -5')
  })
})
