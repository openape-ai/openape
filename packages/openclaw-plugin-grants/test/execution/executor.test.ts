import { describe, expect, it, vi } from 'vitest'
import { executeCommand } from '../../src/execution/executor.js'
import type { PluginApi } from '../../src/types.js'

function mockApi(overrides?: Partial<{ exitCode: number, stdout: string, stderr: string }>): PluginApi {
  return {
    registerTool: vi.fn(),
    on: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerCli: vi.fn(),
    sendChannelMessage: vi.fn(),
    onChannelCommand: vi.fn(),
    runtime: {
      system: {
        runCommandWithTimeout: vi.fn().mockResolvedValue({
          stdout: overrides?.stdout ?? 'output',
          stderr: overrides?.stderr ?? '',
          exitCode: overrides?.exitCode ?? 0,
        }),
      },
      config: {
        getStateDir: () => '/tmp',
        getWorkspaceDir: () => '/tmp',
      },
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }
}

describe('executeCommand', () => {
  it('executes directly without apes', async () => {
    const api = mockApi()
    const result = await executeCommand(api, { command: 'echo', args: ['hello'] })
    expect(result.success).toBe(true)
    expect(result.output).toBe('output')
    expect(api.runtime.system.runCommandWithTimeout).toHaveBeenCalledWith(
      'echo',
      ['hello'],
      { timeout: 30000 },
    )
  })

  it('returns error on non-zero exit code', async () => {
    const api = mockApi({ exitCode: 1, stderr: 'permission denied' })
    const result = await executeCommand(api, { command: 'fail', args: [] })
    expect(result.success).toBe(false)
    expect(result.error).toBe('permission denied')
  })

  it('returns error on exception', async () => {
    const api = mockApi()
    ;(api.runtime.system.runCommandWithTimeout as any).mockRejectedValue(new Error('timeout'))
    const result = await executeCommand(api, { command: 'slow', args: [] })
    expect(result.success).toBe(false)
    expect(result.error).toBe('timeout')
  })

  it('executes via apes when privileged + jwt + binaryPath', async () => {
    const api = mockApi()
    const result = await executeCommand(api, {
      command: 'systemctl',
      args: ['restart', 'nginx'],
      jwt: 'my-jwt',
      privileged: true,
      apesBinaryPath: '/usr/local/bin/apes',
    })
    expect(result.success).toBe(true)
    expect(api.runtime.system.runCommandWithTimeout).toHaveBeenCalledWith(
      '/usr/local/bin/apes',
      ['--grant', 'my-jwt', '--', 'systemctl', 'restart', 'nginx'],
      { timeout: 30000 },
    )
  })

  it('falls back to direct execution when not privileged', async () => {
    const api = mockApi()
    await executeCommand(api, {
      command: 'gh',
      args: ['repo', 'list'],
      jwt: 'my-jwt',
      privileged: false,
      apesBinaryPath: 'apes',
    })
    expect(api.runtime.system.runCommandWithTimeout).toHaveBeenCalledWith(
      'gh',
      ['repo', 'list'],
      { timeout: 30000 },
    )
  })

  it('falls back when no jwt provided', async () => {
    const api = mockApi()
    await executeCommand(api, {
      command: 'gh',
      args: ['repo', 'list'],
      privileged: true,
      apesBinaryPath: 'apes',
    })
    expect(api.runtime.system.runCommandWithTimeout).toHaveBeenCalledWith(
      'gh',
      ['repo', 'list'],
      { timeout: 30000 },
    )
  })

  it('uses custom timeout', async () => {
    const api = mockApi()
    await executeCommand(api, { command: 'slow', args: [], timeout: 60000 })
    expect(api.runtime.system.runCommandWithTimeout).toHaveBeenCalledWith(
      'slow',
      [],
      { timeout: 60000 },
    )
  })
})
