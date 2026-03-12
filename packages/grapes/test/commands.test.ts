import { describe, expect, it, vi } from 'vitest'

// Test that all commands export properly and have correct meta
describe('commands', () => {
  it('login command has correct meta', async () => {
    const { loginCommand } = await import('../src/commands/login')
    expect(loginCommand.meta?.name).toBe('login')
    expect(loginCommand.meta?.description).toBeDefined()
    expect(loginCommand.args).toHaveProperty('idp')
    expect(loginCommand.args).toHaveProperty('key')
    expect(loginCommand.args).toHaveProperty('email')
  })

  it('logout command has correct meta', async () => {
    const { logoutCommand } = await import('../src/commands/logout')
    expect(logoutCommand.meta?.name).toBe('logout')
  })

  it('whoami command has correct meta', async () => {
    const { whoamiCommand } = await import('../src/commands/whoami')
    expect(whoamiCommand.meta?.name).toBe('whoami')
  })

  it('request command has correct meta and args', async () => {
    const { requestCommand } = await import('../src/commands/request')
    expect(requestCommand.meta?.name).toBe('request')
    expect(requestCommand.args).toHaveProperty('command')
    expect(requestCommand.args).toHaveProperty('reason')
    expect(requestCommand.args).toHaveProperty('for')
    expect(requestCommand.args).toHaveProperty('approval')
    expect(requestCommand.args).toHaveProperty('wait')
  })

  it('list command has correct meta and args', async () => {
    const { listCommand } = await import('../src/commands/list')
    expect(listCommand.meta?.name).toBe('list')
    expect(listCommand.args).toHaveProperty('status')
    expect(listCommand.args).toHaveProperty('json')
  })

  it('status command has correct meta and args', async () => {
    const { statusCommand } = await import('../src/commands/status')
    expect(statusCommand.meta?.name).toBe('status')
    expect(statusCommand.args).toHaveProperty('id')
    expect(statusCommand.args).toHaveProperty('json')
  })

  it('token command has correct meta', async () => {
    const { tokenCommand } = await import('../src/commands/token')
    expect(tokenCommand.meta?.name).toBe('token')
    expect(tokenCommand.args).toHaveProperty('id')
  })

  it('revoke command has correct meta', async () => {
    const { revokeCommand } = await import('../src/commands/revoke')
    expect(revokeCommand.meta?.name).toBe('revoke')
    expect(revokeCommand.args).toHaveProperty('id')
  })

  it('approve command has correct meta', async () => {
    const { approveCommand } = await import('../src/commands/approve')
    expect(approveCommand.meta?.name).toBe('approve')
    expect(approveCommand.args).toHaveProperty('id')
  })

  it('deny command has correct meta', async () => {
    const { denyCommand } = await import('../src/commands/deny')
    expect(denyCommand.meta?.name).toBe('deny')
    expect(denyCommand.args).toHaveProperty('id')
  })

  it('exec command has correct meta and args', async () => {
    const { execCommand } = await import('../src/commands/exec')
    expect(execCommand.meta?.name).toBe('exec')
    expect(execCommand.args).toHaveProperty('command')
    expect(execCommand.args).toHaveProperty('apes-path')
  })

  it('delegate command has correct meta and args', async () => {
    const { delegateCommand } = await import('../src/commands/delegate')
    expect(delegateCommand.meta?.name).toBe('delegate')
    expect(delegateCommand.args).toHaveProperty('to')
    expect(delegateCommand.args).toHaveProperty('at')
    expect(delegateCommand.args).toHaveProperty('scopes')
    expect(delegateCommand.args).toHaveProperty('approval')
    expect(delegateCommand.args).toHaveProperty('expires')
  })

  it('delegations command has correct meta', async () => {
    const { delegationsCommand } = await import('../src/commands/delegations')
    expect(delegationsCommand.meta?.name).toBe('delegations')
    expect(delegationsCommand.args).toHaveProperty('json')
  })
})

describe('cli entry', () => {
  it('exports all 13 subcommands', async () => {
    // We can't actually run the CLI, but we can verify the module structure
    // by checking the imported commands are valid citty commands
    const commands = [
      (await import('../src/commands/login')).loginCommand,
      (await import('../src/commands/logout')).logoutCommand,
      (await import('../src/commands/whoami')).whoamiCommand,
      (await import('../src/commands/request')).requestCommand,
      (await import('../src/commands/list')).listCommand,
      (await import('../src/commands/status')).statusCommand,
      (await import('../src/commands/token')).tokenCommand,
      (await import('../src/commands/revoke')).revokeCommand,
      (await import('../src/commands/approve')).approveCommand,
      (await import('../src/commands/deny')).denyCommand,
      (await import('../src/commands/exec')).execCommand,
      (await import('../src/commands/delegate')).delegateCommand,
      (await import('../src/commands/delegations')).delegationsCommand,
    ]

    expect(commands).toHaveLength(13)
    for (const cmd of commands) {
      expect(cmd.meta?.name).toBeDefined()
      expect(cmd.meta?.description).toBeDefined()
    }
  })
})
