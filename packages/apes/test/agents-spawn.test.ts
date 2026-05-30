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
  macOSUsernameForAgent: vi.fn((n: string) => `openape-agent-${n}`),
  MACOS_USER_PREFIX: 'openape-agent-',
}
vi.mock('../src/lib/macos-user.js', () => macosUserMock)

// The host-platform indirection replaces direct imports of macOS helpers
// in production code. Mock its surface here too so the tests can flip
// isDarwin / control the agent-user lookups deterministically.
const runPrivilegedBashMock = vi.fn(async () => {})

const hostPlatformMock = {
  isDarwin: vi.fn(() => true),
  isLinux: vi.fn(() => false),
  getHostPlatform: vi.fn(() => ({
    getHostId: () => 'host-id',
    getHostname: () => 'host',
    agentUsername: (n: string) => macosUserMock.macOSUsernameForAgent(n),
    lookupAgentUser: () => null,
    readAgentUser: () => macosUserMock.readMacOSUser(),
    listAgentUserNames: () => macosUserMock.listMacOSUserNames(),
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

// captureHostBinDirs() shells out to /usr/bin/which to resolve real bin
// dirs on the host. Tests don't need to exercise that probe — stub the
// helper to return a fixed list so spawn-orchestration assertions only
// see the calls they care about.
vi.mock('../src/lib/llm-bridge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/llm-bridge.js')>()
  return {
    ...actual,
    captureHostBinDirs: vi.fn(() => ['/usr/local/bin']),
    // Bridge is now installed by default — stub the .env / config probe
    // so tests don't need a real LITELLM_API_KEY on the host.
    resolveBridgeConfig: vi.fn(() => ({
      baseUrl: 'http://127.0.0.1:4000/v1',
      apiKey: 'sk-test',
      model: 'gpt-5.4',
    })),
    buildBridgeEnvFile: vi.fn(() => 'LITELLM_API_KEY=sk-test\n'),
    buildBridgeStartScript: vi.fn(() => '#!/usr/bin/env bash\nexec ape-agent\n'),
    buildBridgePlist: vi.fn(() => '<plist/>'),
    bridgePlistLabel: vi.fn((n: string) => `eco.hofmann.apes.bridge.${n}`),
    bridgePlistPath: vi.fn((n: string) => `/Library/LaunchDaemons/eco.hofmann.apes.bridge.${n}.plist`),
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
    hostPlatformMock.isDarwin.mockReturnValue(true)
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
    hostPlatformMock.isDarwin.mockReturnValue(false)
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

  it('happy path: registers, issues token, runs setup via platform.runPrivilegedBash', async () => {
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
    expect(buildArgs.x25519PrivateKey).toBe('WDI1NTE5X1BSSVZfRkFLRQ')
    expect(buildArgs.x25519PublicKey).toBe('WDI1NTE5X1BVQl9GQUtF')

    // The spawn script flows to the host platform's privileged-exec boundary;
    // the boundary itself (tmp file + apes run --as root --wait --) is the
    // platform's responsibility and unit-tested separately.
    expect(runPrivilegedBashMock).toHaveBeenCalledTimes(1)
    expect(runPrivilegedBashMock).toHaveBeenCalledWith('#!/bin/bash\necho setup\n')
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
