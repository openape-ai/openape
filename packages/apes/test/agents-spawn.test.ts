import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----------------------------------------------------------------------------
// Mocks: spawn touches a lot of system surfaces, so we stub each one and let
// the orchestration logic run end-to-end against the stubs. Linux-only path:
// no macos-user, no plist builders.
// ----------------------------------------------------------------------------

vi.mock('../src/config.js', () => ({
  loadAuth: vi.fn(() => ({ idp: 'https://id.openape.ai', email: 'patrick@hofmann.eco', access_token: 't', expires_at: 9_999_999_999 })),
  getIdpUrl: vi.fn(() => 'https://id.openape.ai'),
}))

// readAgentUser lookup — null means "no such OS user" (free to create).
const readUserMock = vi.fn(() => null as any)

// The host-platform indirection replaces direct imports of OS helpers
// in production code. Mock its surface here so the tests can control the
// agent-user lookups deterministically. Linux: isLinux=true,
// agentUsername is identity (no prefix).
const runPrivilegedBashMock = vi.fn(async () => {})

const hostPlatformMock = {
  isLinux: vi.fn(() => true),
  getHostPlatform: vi.fn(() => ({
    getHostId: () => 'host-id',
    getHostname: () => 'host',
    agentUsername: (n: string) => n,
    lookupAgentUser: () => null,
    readAgentUser: () => readUserMock(),
    listAgentUserNames: () => new Set<string>(),
    listOrphanAgentUsers: () => [],
    runPrivilegedBash: runPrivilegedBashMock,
    runAsAgentUser: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    installNestSupervisor: vi.fn(async () => {}),
    uninstallNestSupervisor: vi.fn(async () => {}),
  })),
}
vi.mock('../src/lib/host-platform/index.js', () => hostPlatformMock)

vi.mock('../src/lib/keygen.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/keygen.js')>('../src/lib/keygen.js')
  return {
    ...actual,
    generateKeyPairInMemory: vi.fn(() => ({
      privatePem: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
      publicSshLine: 'ssh-ed25519 AAAAFAKE',
      x25519PrivateKey: 'WDI1NTE5X1BSSVZfRkFLRQ',
      x25519PublicKey: 'WDI1NTE5X1BVQl9GQUtF',
    })),
  }
})

const bootstrapMock = {
  AGENT_NAME_REGEX: /^[a-z][a-z0-9-]{0,23}$/,
  CLAUDE_SETTINGS_JSON: '{}',
  BASH_VIA_APE_SHELL_HOOK_SOURCE: '#!/bin/bash\n',
  registerAgentAtIdp: vi.fn(async () => ({
    email: 'agent-a+patrick+hofmann_eco@id.openape.ai',
    name: 'agent-a',
    owner: 'patrick@hofmann.eco',
    approver: 'patrick@hofmann.eco',
    status: 'active',
  })),
  issueAgentToken: vi.fn(async () => ({ token: 'agent-token', expiresIn: 3600 })),
  buildAgentAuthJson: vi.fn(() => '{"idp":"x"}\n'),
  buildSpawnSetupScript: vi.fn(() => '#!/bin/bash\necho setup\n'),
}
vi.mock('../src/lib/agent-bootstrap.js', () => bootstrapMock)

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    mkdtempSync: vi.fn(() => '/tmp/apes-spawn-test'),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
  }
})

describe('apes agents spawn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    readUserMock.mockReturnValue(null)
    hostPlatformMock.isLinux.mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('rejects an invalid agent name', async () => {
    const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
    await expect((spawnAgentCommand as any).run({
      args: { name: 'BadName' },
    })).rejects.toThrow(/Invalid agent name/)
  })

  it('refuses when the OS user already exists', async () => {
    readUserMock.mockReturnValue({ name: 'agent-a', uid: 1001, shell: '/bin/bash', homeDir: '/var/lib/openape/homes/agent-a' })
    const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
    await expect((spawnAgentCommand as any).run({
      args: { name: 'agent-a' },
    })).rejects.toThrow(/already exists/)
  })

  it('happy path: registers, issues token, runs the linux setup script', async () => {
    const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
    await (spawnAgentCommand as any).run({ args: { name: 'agent-a' } })

    expect(bootstrapMock.registerAgentAtIdp).toHaveBeenCalledWith({
      name: 'agent-a',
      publicKey: 'ssh-ed25519 AAAAFAKE',
      idp: 'https://id.openape.ai',
    })
    expect(bootstrapMock.buildSpawnSetupScript).toHaveBeenCalledTimes(1)
    const buildArgs = bootstrapMock.buildSpawnSetupScript.mock.calls[0]![0] as any
    expect(buildArgs.shellPath).toBe('/bin/bash')
    expect(buildArgs.homeDir).toBe('/var/lib/openape/homes/agent-a')
    expect(buildArgs).not.toHaveProperty('macOSUsername')
    expect(buildArgs).not.toHaveProperty('bridge')
    expect(buildArgs).not.toHaveProperty('troop')
    expect(runPrivilegedBashMock).toHaveBeenCalledTimes(1)
  })

  it('--no-claude-hook passes nulls for the claude settings + hook source', async () => {
    const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
    await (spawnAgentCommand as any).run({ args: { name: 'agent-a', 'no-claude-hook': true } })

    const buildArgs = bootstrapMock.buildSpawnSetupScript.mock.calls[0]![0] as any
    expect(buildArgs.claudeSettingsJson).toBeNull()
    expect(buildArgs.hookScriptSource).toBeNull()
  })

  it('propagates errors when runPrivilegedBash fails', async () => {
    runPrivilegedBashMock.mockImplementationOnce(async () => { throw new Error('approval denied') })

    const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
    await expect((spawnAgentCommand as any).run({ args: { name: 'agent-a' } })).rejects.toThrow(/approval denied/)
    // Tmp-dir lifecycle is owned by runPrivilegedBash; the spawn command no
    // longer manages a scratch dir of its own.
  })
})
