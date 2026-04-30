import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/config.js', () => ({
  loadAuth: vi.fn(() => ({ idp: 'https://id.openape.ai', email: 'patrick@hofmann.eco', access_token: 't', expires_at: 9_999_999_999 })),
  getIdpUrl: vi.fn(() => 'https://id.openape.ai'),
}))

vi.mock('../src/http.js', () => ({
  apiFetch: vi.fn(),
}))

const REG_RESULT = {
  email: 'agent-a+patrick+hofmann_eco@id.openape.ai',
  name: 'agent-a',
  owner: 'patrick@hofmann.eco',
  approver: 'patrick@hofmann.eco',
  status: 'active',
}

describe('apes agents register', () => {
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

  it('rejects an invalid agent name', async () => {
    const { registerAgentCommand } = await import('../src/commands/agents/register.js')
    await expect((registerAgentCommand as any).run({
      args: { name: 'BadName', 'public-key': 'ssh-ed25519 AAAA' },
    })).rejects.toThrow(/Invalid agent name/)
  })

  it('rejects a non-ssh-ed25519 public key', async () => {
    const { registerAgentCommand } = await import('../src/commands/agents/register.js')
    await expect((registerAgentCommand as any).run({
      args: { name: 'agent-a', 'public-key': 'ssh-rsa AAAA' },
    })).rejects.toThrow(/ssh-ed25519/)
  })

  it('rejects when both --public-key and --public-key-file are supplied', async () => {
    const { registerAgentCommand } = await import('../src/commands/agents/register.js')
    await expect((registerAgentCommand as any).run({
      args: { name: 'agent-a', 'public-key': 'ssh-ed25519 AAAA', 'public-key-file': '/tmp/x' },
    })).rejects.toThrow(/either --public-key or --public-key-file/)
  })

  it('reads --public-key-file and POSTs to /api/enroll with the parsed key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apes-reg-'))
    const pubFile = join(dir, 'k.pub')
    writeFileSync(pubFile, 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 me@host\n')

    try {
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch).mockResolvedValueOnce(REG_RESULT as any)

      const { registerAgentCommand } = await import('../src/commands/agents/register.js')
      await (registerAgentCommand as any).run({
        args: { name: 'agent-a', 'public-key-file': pubFile },
      })

      expect(apiFetch).toHaveBeenCalledWith('/api/enroll', {
        method: 'POST',
        body: { name: 'agent-a', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 me@host' },
        idp: 'https://id.openape.ai',
      })
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('--json emits a single line of parseable JSON to stdout', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce(REG_RESULT as any)

    const { registerAgentCommand } = await import('../src/commands/agents/register.js')
    await (registerAgentCommand as any).run({
      args: { name: 'agent-a', 'public-key': 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5', json: true },
    })

    expect(writeSpy).toHaveBeenCalled()
    const out = (writeSpy.mock.calls[0]![0] as string).trim()
    const parsed = JSON.parse(out)
    expect(parsed).toEqual({
      email: 'agent-a+patrick+hofmann_eco@id.openape.ai',
      name: 'agent-a',
      owner: 'patrick@hofmann.eco',
      approver: 'patrick@hofmann.eco',
      idp: 'https://id.openape.ai',
    })
  })

  it('default output prints the login hint', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce(REG_RESULT as any)

    const { registerAgentCommand } = await import('../src/commands/agents/register.js')
    await (registerAgentCommand as any).run({
      args: { name: 'agent-a', 'public-key': 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5' },
    })

    const lines = logSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(lines).toContain('apes login --idp https://id.openape.ai --email agent-a+patrick+hofmann_eco@id.openape.ai')
  })
})
