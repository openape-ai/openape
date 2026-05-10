import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----------------------------------------------------------------------------
// Mocks: spawn touches a lot of system surfaces, so we stub each one and let
// the orchestration logic run end-to-end against the stubs.
// ----------------------------------------------------------------------------

vi.mock('../src/config.js', () => ({
  loadAuth: vi.fn(() => ({ idp: 'https://id.openape.ai', email: 'patrick@hofmann.eco', access_token: 't', expires_at: 9_999_999_999 })),
  getIdpUrl: vi.fn(() => 'https://id.openape.ai'),
}))

const macosUserMock = {
  isDarwin: vi.fn(() => true),
  readMacOSUser: vi.fn(() => null),
  whichBinary: vi.fn((name: string) => `/usr/local/bin/${name}`),
  isShellRegistered: vi.fn(() => true),
  listMacOSUserNames: vi.fn(() => new Set<string>()),
}
vi.mock('../src/lib/macos-user.js', () => macosUserMock)

vi.mock('../src/lib/keygen.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/keygen.js')>('../src/lib/keygen.js')
  return {
    ...actual,
    generateKeyPairInMemory: vi.fn(() => ({
      privatePem: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
      publicSshLine: 'ssh-ed25519 AAAAFAKE',
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

// captureHostBinDirs() shells out to /usr/bin/which to resolve real bin
// dirs on the host. Tests don't need to exercise that probe — stub the
// helper to return a fixed list so spawn-orchestration assertions only
// see the calls they care about.
vi.mock('../src/lib/llm-bridge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/llm-bridge.js')>()
  return {
    ...actual,
    captureHostBinDirs: vi.fn(() => ['/usr/local/bin']),
  }
})

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
    macosUserMock.isDarwin.mockReturnValue(true)
    macosUserMock.readMacOSUser.mockReturnValue(null)
    macosUserMock.whichBinary.mockImplementation((name: string) => `/usr/local/bin/${name}`)
    macosUserMock.isShellRegistered.mockReturnValue(true)
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

  it('rejects on non-darwin platforms', async () => {
    macosUserMock.isDarwin.mockReturnValue(false)
    const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
    await expect((spawnAgentCommand as any).run({
      args: { name: 'agent-a' },
    })).rejects.toThrow(/macOS-only/)
  })

  it('rejects when default login shell (/bin/zsh) is not in /etc/shells', async () => {
    macosUserMock.isShellRegistered.mockReturnValue(false)
    const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
    await expect((spawnAgentCommand as any).run({
      args: { name: 'agent-a' },
    })).rejects.toThrow(/not registered in \/etc\/shells/)
  })

  it('rejects when target macOS user already exists', async () => {
    macosUserMock.readMacOSUser.mockReturnValue({ name: 'agent-a', uid: 250, shell: '/bin/zsh' })
    const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
    await expect((spawnAgentCommand as any).run({
      args: { name: 'agent-a' },
    })).rejects.toThrow(/already exists/)
  })

  it('rejects when escapes binary is missing', async () => {
    macosUserMock.whichBinary.mockImplementation((n: string) => n === 'escapes' ? null : `/usr/local/bin/${n}`)
    const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
    await expect((spawnAgentCommand as any).run({
      args: { name: 'agent-a' },
    })).rejects.toThrow(/escapes/)
  })

  it('happy path: registers, issues token, runs setup via apes run --as root, cleans up', async () => {
    const { execFileSync } = await import('node:child_process')
    const { rmSync, writeFileSync } = await import('node:fs')

    const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
    await (spawnAgentCommand as any).run({ args: { name: 'agent-a' } })

    expect(bootstrapMock.registerAgentAtIdp).toHaveBeenCalledWith({
      name: 'agent-a',
      publicKey: 'ssh-ed25519 AAAAFAKE',
      idp: 'https://id.openape.ai',
    })
    expect(bootstrapMock.issueAgentToken).toHaveBeenCalledWith({
      idp: 'https://id.openape.ai',
      agentEmail: 'agent-a+patrick+hofmann_eco@id.openape.ai',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
    })
    expect(bootstrapMock.buildSpawnSetupScript).toHaveBeenCalledTimes(1)
    const buildArgs = bootstrapMock.buildSpawnSetupScript.mock.calls[0]![0] as any
    expect(buildArgs.claudeSettingsJson).toBe('{}') // hook included by default
    expect(buildArgs.shellPath).toBe('/bin/zsh')

    expect(writeFileSync).toHaveBeenCalledWith(
      '/tmp/apes-spawn-test/setup.sh',
      '#!/bin/bash\necho setup\n',
      { mode: 0o700 },
    )

    expect(execFileSync).toHaveBeenCalledTimes(1)
    const [bin, argv] = vi.mocked(execFileSync).mock.calls[0]!
    expect(bin).toBe('/usr/local/bin/apes')
    expect(argv).toEqual(['run', '--as', 'root', '--wait', '--', 'bash', '/tmp/apes-spawn-test/setup.sh'])

    expect(rmSync).toHaveBeenCalledWith('/tmp/apes-spawn-test', { recursive: true, force: true })
  })

  it('--no-claude-hook passes nulls for the claude settings + hook source', async () => {
    const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
    await (spawnAgentCommand as any).run({ args: { name: 'agent-a', 'no-claude-hook': true } })

    const buildArgs = bootstrapMock.buildSpawnSetupScript.mock.calls[0]![0] as any
    expect(buildArgs.claudeSettingsJson).toBeNull()
    expect(buildArgs.hookScriptSource).toBeNull()
  })

  it('cleans up the scratch dir even when escapes fails', async () => {
    const { execFileSync } = await import('node:child_process')
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('approval denied') })
    const { rmSync } = await import('node:fs')

    const { spawnAgentCommand } = await import('../src/commands/agents/spawn.js')
    await expect((spawnAgentCommand as any).run({ args: { name: 'agent-a' } })).rejects.toThrow(/approval denied/)

    expect(rmSync).toHaveBeenCalledWith('/tmp/apes-spawn-test', { recursive: true, force: true })
  })
})
