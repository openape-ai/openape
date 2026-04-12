import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyGrantPending } from '../src/notifications'
import type { PendingGrantInfo } from '../src/notifications'

// Mock child_process.spawn so we can assert what was spawned without
// actually running shell commands.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = {
      unref: vi.fn(),
      kill: vi.fn(),
      on: vi.fn(),
    }
    return child
  }),
}))

// Mock config so we can control the notification command per test.
vi.mock('../src/config', () => ({
  loadConfig: vi.fn(() => ({})),
}))

const sampleInfo: PendingGrantInfo = {
  grantId: 'grant-abc-123',
  approveUrl: 'https://id.openape.at/grant-approval?grant_id=grant-abc-123',
  command: 'ls -la /tmp',
  audience: 'shapes',
  host: 'test-host',
}

describe('notifyGrantPending', () => {
  const savedEnv = process.env.APES_NOTIFY_PENDING_COMMAND

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.APES_NOTIFY_PENDING_COMMAND
  })

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.APES_NOTIFY_PENDING_COMMAND
    else process.env.APES_NOTIFY_PENDING_COMMAND = savedEnv
  })

  it('does nothing when no notification command is configured', async () => {
    const { spawn } = await import('node:child_process')
    notifyGrantPending(sampleInfo)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('spawns the configured command from env var with template substitution', async () => {
    process.env.APES_NOTIFY_PENDING_COMMAND = 'echo {grant_id} {command} {approve_url}'
    const { spawn } = await import('node:child_process')

    notifyGrantPending(sampleInfo)

    expect(spawn).toHaveBeenCalledOnce()
    const [shell, args] = vi.mocked(spawn).mock.calls[0]!
    expect(shell).toBe('sh')
    expect(args![0]).toBe('-c')
    // The rendered command should contain the escaped grant id and command
    const rendered = args![1] as string
    expect(rendered).toContain('grant-abc-123')
    expect(rendered).toContain('ls')
    expect(rendered).toContain('openape.at')
  })

  it('reads the command from config.toml when env var is not set', async () => {
    const { loadConfig } = await import('../src/config')
    vi.mocked(loadConfig).mockReturnValue({
      notifications: { pending_command: 'notify-send {command}' },
    })
    const { spawn } = await import('node:child_process')

    notifyGrantPending(sampleInfo)

    expect(spawn).toHaveBeenCalledOnce()
    const rendered = vi.mocked(spawn).mock.calls[0]![1]![1] as string
    expect(rendered).toContain('notify-send')
  })

  it('prefers env var over config.toml', async () => {
    process.env.APES_NOTIFY_PENDING_COMMAND = 'env-command {grant_id}'
    const { loadConfig } = await import('../src/config')
    vi.mocked(loadConfig).mockReturnValue({
      notifications: { pending_command: 'config-command {grant_id}' },
    })
    const { spawn } = await import('node:child_process')

    notifyGrantPending(sampleInfo)

    const rendered = vi.mocked(spawn).mock.calls[0]![1]![1] as string
    expect(rendered).toContain('env-command')
    expect(rendered).not.toContain('config-command')
  })

  it('shell-escapes template values to prevent injection', async () => {
    process.env.APES_NOTIFY_PENDING_COMMAND = 'echo {command}'
    const { spawn } = await import('node:child_process')

    notifyGrantPending({
      ...sampleInfo,
      command: 'rm -rf / && echo pwned',
    })

    const rendered = vi.mocked(spawn).mock.calls[0]![1]![1] as string
    // shell-quote wraps dangerous strings in single quotes so && is not
    // interpreted as a shell operator. The rendered command should contain
    // the quoted form, not the raw unquoted form.
    expect(rendered).toContain('\'')
    // The raw unquoted form that would execute as two shell commands must
    // not appear — it must be inside quoting.
    expect(rendered).toMatch(/echo '/)
  })

  it('spawns detached and unrefed (fire-and-forget)', async () => {
    process.env.APES_NOTIFY_PENDING_COMMAND = 'echo test'
    const { spawn } = await import('node:child_process')

    notifyGrantPending(sampleInfo)

    const spawnOpts = vi.mocked(spawn).mock.calls[0]![2] as Record<string, unknown>
    expect(spawnOpts.detached).toBe(true)
    expect(spawnOpts.stdio).toBe('ignore')

    const child = vi.mocked(spawn).mock.results[0]!.value
    expect(child.unref).toHaveBeenCalled()
  })
})
