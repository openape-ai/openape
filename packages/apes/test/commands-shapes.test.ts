import { mkdtempSync, writeFileSync } from 'node:fs'
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
    await expect(run('publish', file)).rejects.toThrow(/Only the human owner/)
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
})
