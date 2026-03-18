import { describe, expect, it, vi } from 'vitest'
import { register } from '../src/index.js'
import type { PluginApi } from '../src/types.js'

function createMockApi(): PluginApi & { _registered: Record<string, any> } {
  const _registered: Record<string, any> = {
    tools: [] as any[],
    hooks: [] as any[],
    httpRoutes: [] as any[],
    cliCommands: [] as any[],
    channelCommands: [] as any[],
  }

  return {
    _registered,
    registerTool: vi.fn((tool) => { _registered.tools.push(tool) }),
    on: vi.fn((event, handler, opts) => { _registered.hooks.push({ event, handler, ...opts }) }),
    registerHttpRoute: vi.fn((route) => { _registered.httpRoutes.push(route) }),
    registerCli: vi.fn((cmd) => { _registered.cliCommands.push(cmd) }),
    sendChannelMessage: vi.fn().mockResolvedValue(undefined),
    onChannelCommand: vi.fn((cmd, handler) => { _registered.channelCommands.push({ cmd, handler }) }),
    runtime: {
      system: {
        runCommandWithTimeout: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
      },
      config: {
        getStateDir: () => '/tmp/test-state',
        getWorkspaceDir: () => '/tmp/test-workspace',
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

describe('register', () => {
  it('registers grant_exec tool', () => {
    const api = createMockApi()
    register(api)

    expect(api.registerTool).toHaveBeenCalledTimes(1)
    const tool = api._registered.tools[0]
    expect(tool.name).toBe('grant_exec')
    expect(tool.inputSchema.required).toContain('command')
  })

  it('registers before_tool_call hook with priority 100', () => {
    const api = createMockApi()
    register(api)

    expect(api.on).toHaveBeenCalledTimes(1)
    expect(api.on).toHaveBeenCalledWith(
      'before_tool_call',
      expect.any(Function),
      { priority: 100 },
    )
  })

  it('registers JWKS HTTP route', () => {
    const api = createMockApi()
    register(api)

    const route = api._registered.httpRoutes[0]
    expect(route.path).toBe('/grants/.well-known/jwks.json')
    expect(route.method).toBe('GET')
  })

  it('registers grants CLI command with subcommands', () => {
    const api = createMockApi()
    register(api)

    const cmd = api._registered.cliCommands[0]
    expect(cmd.name).toBe('grants')
    expect(cmd.subcommands).toHaveLength(4)
    expect(cmd.subcommands.map((s: any) => s.name)).toEqual(['status', 'list', 'revoke', 'adapters'])
  })

  it('registers channel commands in local mode', () => {
    const api = createMockApi()
    register(api, { mode: 'local' })

    expect(api.onChannelCommand).toHaveBeenCalledWith('grant-approve', expect.any(Function))
    expect(api.onChannelCommand).toHaveBeenCalledWith('grant-deny', expect.any(Function))
  })

  it('loads bundled adapters', () => {
    const api = createMockApi()
    register(api)

    // Should log adapter loading
    expect(api.log.info).toHaveBeenCalledWith(
      expect.stringContaining('Loaded'),
    )
  })
})

describe('before_tool_call hook', () => {
  it('blocks exec tool', async () => {
    const api = createMockApi()
    register(api)

    const hook = api._registered.hooks[0]
    const result = await hook.handler({ toolName: 'exec', toolInput: {} })
    expect(result.allow).toBe(false)
    expect(result.message).toContain('grant_exec')
  })

  it('blocks bash tool', async () => {
    const api = createMockApi()
    register(api)

    const hook = api._registered.hooks[0]
    const result = await hook.handler({ toolName: 'bash', toolInput: {} })
    expect(result.allow).toBe(false)
  })

  it('allows non-exec tools', async () => {
    const api = createMockApi()
    register(api)

    const hook = api._registered.hooks[0]
    const result = await hook.handler({ toolName: 'read_file', toolInput: {} })
    expect(result.allow).toBe(true)
  })

  it('blocks shell and run_command', async () => {
    const api = createMockApi()
    register(api)

    const hook = api._registered.hooks[0]

    const r1 = await hook.handler({ toolName: 'shell', toolInput: {} })
    expect(r1.allow).toBe(false)

    const r2 = await hook.handler({ toolName: 'run_command', toolInput: {} })
    expect(r2.allow).toBe(false)
  })
})
