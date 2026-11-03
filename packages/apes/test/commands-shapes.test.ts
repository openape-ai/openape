import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from 'citty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = { idp: 'https://idp.test', access_token: 'owner-token', email: 'alice@example.com', expires_at: Math.floor(Date.now() / 1000) + 3600 }

vi.mock('../src/config.js', () => ({
  loadAuth: vi.fn(),
  loadConfig: vi.fn(() => ({})),
  saveAuth: vi.fn(),
  getAuthToken: vi.fn(() => 'owner-token'),
  getIdpUrl: vi.fn(() => 'https://idp.test'),
}))

const TOML = `schema = "openape-shapes/v1"

[cli]
id = "mytool"
executable = "mytool"
audience = "shapes"
version = "1"

[[operation]]
id = "mytool.sync"
command = ["sync"]
positionals = ["dir"]
display = "Sync {dir}"
action = "write"
risk = "medium"
resource_chain = ["filesystem:path={dir}"]
`

const grant = { id: 'g-1', requester: 'agent+bot@example.com', operation_id: 'mytool.sync', grant_type: 'always', decided_at: 1, digest_current: true }
const shape = { cli_id: 'mytool', executable: 'mytool', digest: 'SHA-256:abcdef0123456789', toml: TOML, operations: [{ id: 'mytool.sync', command: ['sync'], action: 'write', risk: 'medium', display: 'Sync {dir}' }], created_at: 1, published_at: 1_793_000_000, bound_grants: [grant] }
const publishBody = (saved: boolean) => ({ saved, shape, replaced_digest: 'SHA-256:old', grants_losing_reuse: [grant] })

function json(body: unknown, status = 200, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': type } })
}

let fetchMock: ReturnType<typeof vi.fn>
let output: string
let file: string

async function run(...rawArgs: string[]) {
  const { shapesCommand } = await import('../src/commands/shapes/index.js')
  return runCommand(shapesCommand, { rawArgs })
}

function calls(): string[] {
  return fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
}

describe('apes shapes', () => {
  beforeEach(async () => {
    const { loadAuth } = await import('../src/config.js')
    vi.mocked(loadAuth).mockReturnValue(auth as any)
    file = join(mkdtempSync(join(tmpdir(), 'apes-shapes-')), 'adapter.toml')
    writeFileSync(file, TOML)
    output = ''
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => { output += `${line}\n` })
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => { output += String(chunk); return true })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('previews with a dry run, then publishes with the owner token', async () => {
    fetchMock.mockResolvedValueOnce(json(publishBody(false))).mockResolvedValueOnce(json(publishBody(true)))
    await run('publish', file, '--yes')
    expect(calls()).toEqual(['PUT https://idp.test/api/shapes/mytool?dry_run=1', 'PUT https://idp.test/api/shapes/mytool'])
    const [, init] = fetchMock.mock.calls[1]!
    expect(init.headers.Authorization).toBe('Bearer owner-token')
    expect(JSON.parse(init.body)).toEqual({ toml: TOML })
    expect(output).toContain('Executable:  mytool')
    expect(output).toMatch(/mytool\.sync\s+sync\s+write\s+medium\s+Sync \{dir\}/)
    expect(output).toContain('Visible only to you.')
    expect(output).toContain('1 continuing grant(s) stop being reused')
    expect(output).toContain('agent+bot@example.com')
  })

  it('stops without --yes when continuing grants would stop being reused', async () => {
    fetchMock.mockResolvedValueOnce(json(publishBody(false)))
    await expect(run('publish', file)).rejects.toMatchObject({ name: 'CliError', message: expect.stringContaining('--yes') })
    expect(calls()).toEqual(['PUT https://idp.test/api/shapes/mytool?dry_run=1'])
  })

  it('does not publish with --dry-run', async () => {
    fetchMock.mockResolvedValueOnce(json(publishBody(false)))
    await run('publish', file, '--dry-run')
    expect(calls()).toEqual(['PUT https://idp.test/api/shapes/mytool?dry_run=1'])
  })

  it('surfaces the server problem title and publishes nothing', async () => {
    fetchMock.mockResolvedValueOnce(json({ status: 409, title: 'The shapes-registry already describes mytool; use or extend the registry shape' }, 409, 'application/problem+json'))
    await expect(run('publish', file)).rejects.toMatchObject({ name: 'CliError', exitCode: 1, message: 'The shapes-registry already describes mytool; use or extend the registry shape' })
    expect(calls()).toHaveLength(1)
  })

  it('fails locally on a broken adapter and for agent logins', async () => {
    writeFileSync(file, '[cli]\nid = ')
    await expect(run('publish', file)).rejects.toThrow(/Invalid adapter/)
    writeFileSync(file, TOML)
    const { loadAuth } = await import('../src/config.js')
    vi.mocked(loadAuth).mockReturnValue({ ...auth, email: 'agent+bot@example.com' } as any)
    await expect(run('publish', file)).rejects.toThrow(/Only a human can manage personal shapes/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists own shapes with --mine', async () => {
    fetchMock.mockResolvedValueOnce(json([shape]))
    await run('list', '--mine')
    expect(calls()).toEqual(['GET https://idp.test/api/shapes?mine=1'])
    expect(output).toMatch(/mytool\s+1\s+abcdef012345\s+2026-\d\d-\d\d\s+1/)
  })

  it('removes a shape with DELETE', async () => {
    fetchMock.mockResolvedValueOnce(json({ removed: true, grants_losing_reuse: [grant] }))
    await run('remove', 'mytool')
    expect(calls()).toEqual(['DELETE https://idp.test/api/shapes/mytool'])
    expect(output).toContain('g-1')
  })

  describe('import', () => {
    const report = (overrides: Record<string, unknown> = {}) => ({ scope: 'instance', scope_key: null, dry_run: true, saved: false, added: ['mytool'], rules_changed: [], text_changed: [], removed: [], unchanged: [], grants_losing_reuse: [], grants_keeping_reuse: [], overrides: [], ...overrides })
    let registry: string

    beforeEach(() => {
      registry = mkdtempSync(join(tmpdir(), 'apes-registry-'))
      mkdirSync(join(registry, 'adapters', 'mytool'), { recursive: true })
      writeFileSync(join(registry, 'adapters', 'mytool', 'adapter.toml'), TOML)
      writeFileSync(join(registry, 'adapters', 'mytool', 'meta.json'), JSON.stringify({ description: 'My tool' }))
      vi.stubEnv('APES_MANAGEMENT_TOKEN', 'management-secret')
    })
    afterEach(() => { vi.unstubAllEnvs() })

    it('reads the registry layout, previews, then imports IdP-wide shapes with the management token from the environment', async () => {
      execFileSync('git', ['init', '-q', registry])
      execFileSync('git', ['-C', registry, 'remote', 'add', 'origin', 'https://user:secret@git.example/shapes-registry.git'])
      execFileSync('git', ['-C', registry, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.'])
      execFileSync('git', ['-C', registry, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init'])
      fetchMock.mockResolvedValueOnce(json(report())).mockResolvedValueOnce(json(report({ dry_run: false, saved: true })))
      await run('import', registry, '--scope', 'instance', '--prune')
      expect(calls()).toEqual(['POST https://idp.test/api/shapes/import?scope=instance&dry_run=1', 'POST https://idp.test/api/shapes/import?scope=instance'])
      const [, init] = fetchMock.mock.calls[1]!
      expect(init.headers.Authorization).toBe('Bearer management-secret')
      const body = JSON.parse(init.body)
      expect(body).toMatchObject({ shapes: [{ toml: TOML, description: 'My tool' }], prune: true, source: { repo: 'https://git.example/shapes-registry.git', commit: expect.stringMatching(/^[0-9a-f]{40}$/), dirty: false } })
      expect(output).toContain('Added:          mytool')
      expect(output).not.toContain('management-secret')
      expect(output).not.toContain('secret@')
    })

    it('never runs a helper program named by the checkout\'s git config while reading the source', async () => {
      execFileSync('git', ['init', '-q', registry])
      execFileSync('git', ['-C', registry, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.'])
      execFileSync('git', ['-C', registry, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init'])
      // Outside the checkout, so git status itself does not list it.
      const marker = join(mkdtempSync(join(tmpdir(), 'apes-fsmonitor-')), 'ran')
      execFileSync('git', ['-C', registry, 'config', 'core.fsmonitor', `touch ${marker}; echo`])
      fetchMock.mockResolvedValueOnce(json(report()))
      await run('import', registry, '--scope', 'instance', '--dry-run')
      const { existsSync, utimesSync } = await import('node:fs')
      expect(existsSync(marker)).toBe(false)
      // A clean filter the checkout defines is never run; the source then counts as uncommitted.
      writeFileSync(join(registry, '.gitattributes'), '*.toml filter=evil\n')
      execFileSync('git', ['-C', registry, 'config', 'filter.evil.clean', `touch ${marker}; cat`])
      // Same content, newer time: git status would hash the file through the filter.
      utimesSync(join(registry, 'adapters', 'mytool', 'adapter.toml'), new Date(), new Date(Date.now() + 5000))
      fetchMock.mockResolvedValueOnce(json(report()))
      await run('import', registry, '--scope', 'instance', '--dry-run')
      expect(existsSync(marker)).toBe(false)
      expect(JSON.parse(fetchMock.mock.calls[1]![1].body).source.dirty).toBe(true)
      // The same filter in the worktree-scoped config is found too.
      execFileSync('git', ['-C', registry, 'config', '--unset', 'filter.evil.clean'])
      execFileSync('git', ['-C', registry, 'config', 'extensions.worktreeConfig', 'true'])
      execFileSync('git', ['-C', registry, 'config', '--worktree', 'filter.evil.clean', `touch ${marker}; cat`])
      utimesSync(join(registry, 'adapters', 'mytool', 'adapter.toml'), new Date(), new Date(Date.now() + 10000))
      fetchMock.mockResolvedValueOnce(json(report()))
      await run('import', registry, '--scope', 'instance', '--dry-run')
      expect(existsSync(marker)).toBe(false)
    })

    it('never takes the management token from anywhere but the environment', async () => {
      vi.stubEnv('APES_MANAGEMENT_TOKEN', '')
      await expect(run('import', registry, '--scope', 'instance')).rejects.toThrow(/APES_MANAGEMENT_TOKEN/)
      await expect(run('import', registry, '--scope', 'instance', '--token', 'x')).rejects.toThrow(/APES_MANAGEMENT_TOKEN/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('imports a plain folder of adapter files as domain shapes with the login and stops at a dry run', async () => {
      const folder = mkdtempSync(join(tmpdir(), 'apes-plain-'))
      writeFileSync(join(folder, 'mytool.toml'), TOML)
      fetchMock.mockResolvedValueOnce(json(report({ scope: 'domain', scope_key: 'example.com' })))
      await run('import', folder, '--scope', 'domain', '--dry-run')
      expect(calls()).toEqual(['POST https://idp.test/api/shapes/import?scope=domain&dry_run=1'])
      const [, init] = fetchMock.mock.calls[0]!
      expect(init.headers.Authorization).toBe('Bearer owner-token')
      expect(JSON.parse(init.body)).toEqual({ shapes: [{ toml: TOML }] })
      expect(output).toContain('domain example.com')
    })

    it('stops without --yes when grants would stop covering, writes nothing on an unchanged repeat and surfaces refusals', async () => {
      fetchMock.mockResolvedValueOnce(json(report({ scope: 'domain', overrides: [{ cli_id: 'git', tier: 'instance', by: 'mytool', grants: [grant] }] })))
      await expect(run('import', registry, '--scope', 'domain')).rejects.toThrow(/--yes/)
      fetchMock.mockResolvedValueOnce(json(report({ added: [], unchanged: ['mytool'] })))
      await run('import', registry, '--scope', 'instance')
      // The unchanged repeat sends only its preview.
      expect(calls()).toHaveLength(2)
      fetchMock.mockResolvedValueOnce(json({ statusCode: 403, statusMessage: 'Only a root admin or operator of example.com manages its domain shapes', data: { title: 'Only a root admin or operator of example.com manages its domain shapes' } }, 403))
      await expect(run('import', registry, '--scope', 'domain')).rejects.toThrow('Only a root admin or operator of example.com')
      expect(calls()).toHaveLength(3)
    })

    it('publishes and removes domain shapes with the scope in the URL', async () => {
      fetchMock.mockResolvedValueOnce(json({ ...publishBody(false), grants_losing_reuse: [] })).mockResolvedValueOnce(json(publishBody(true))).mockResolvedValueOnce(json({ removed: true, grants_losing_reuse: [] }))
      await run('publish', file, '--scope', 'domain')
      await run('remove', 'mytool', '--scope', 'domain')
      expect(calls()).toEqual(['PUT https://idp.test/api/shapes/mytool?scope=domain&dry_run=1', 'PUT https://idp.test/api/shapes/mytool?scope=domain', 'DELETE https://idp.test/api/shapes/mytool?scope=domain'])
      await expect(run('remove', 'mytool', '--scope', 'everyone')).rejects.toThrow(/--scope must be/)
    })
  })
})
