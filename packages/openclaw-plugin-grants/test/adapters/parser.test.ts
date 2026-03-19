import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadAdapterFromFile } from '../../src/adapters/loader.js'
import { createFallbackCommand, parseCommandString, resolveCommand, resolveCommandFromAdapters } from '../../src/adapters/parser.js'

const ADAPTERS_DIR = join(import.meta.dirname, '..', '..', 'adapters')

describe('parseCommandString', () => {
  it('splits simple commands', () => {
    expect(parseCommandString('gh repo list openape')).toEqual(['gh', 'repo', 'list', 'openape'])
  })

  it('handles quoted arguments', () => {
    expect(parseCommandString('gh pr comment -b "LGTM looks good"')).toEqual(['gh', 'pr', 'comment', '-b', 'LGTM looks good'])
  })

  it('handles single quotes', () => {
    expect(parseCommandString('echo \'hello world\'')).toEqual(['echo', 'hello world'])
  })

  it('handles multiple spaces', () => {
    expect(parseCommandString('gh  repo   list  openape')).toEqual(['gh', 'repo', 'list', 'openape'])
  })
})

describe('resolveCommand with gh adapter', () => {
  const ghAdapter = loadAdapterFromFile(join(ADAPTERS_DIR, 'gh.toml'))

  it('resolves gh repo list', async () => {
    const result = await resolveCommand(ghAdapter, ['gh', 'repo', 'list', 'openape'])
    expect(result.detail.cli_id).toBe('gh')
    expect(result.detail.operation_id).toBe('repo.list')
    expect(result.detail.action).toBe('list')
    expect(result.detail.risk).toBe('low')
    expect(result.permission).toBe('gh.owner[login=openape].repo[*]#list')
    expect(result.detail.display).toBe('List repositories for owner openape')
  })

  it('resolves gh repo view with --repo', async () => {
    const result = await resolveCommand(ghAdapter, ['gh', 'repo', 'view', '--repo', 'openape/core'])
    expect(result.detail.operation_id).toBe('repo.view')
    expect(result.permission).toBe('gh.repo[name=core,owner=openape]#read')
    expect(result.bindings.repo).toBe('openape/core')
  })

  it('resolves gh issue list', async () => {
    const result = await resolveCommand(ghAdapter, ['gh', 'issue', 'list', '--repo', 'openape/core'])
    expect(result.detail.operation_id).toBe('issue.list')
    expect(result.permission).toBe('gh.repo[name=core,owner=openape].issue[*]#list')
  })

  it('resolves gh repo rename (high risk, exact_command)', async () => {
    const result = await resolveCommand(ghAdapter, ['gh', 'repo', 'rename', 'new-name', '--repo', 'openape/core'])
    expect(result.detail.operation_id).toBe('repo.rename')
    expect(result.detail.risk).toBe('high')
    expect(result.detail.constraints).toEqual({ exact_command: true })
    expect(result.permission).toBe('gh.repo[name=core,owner=openape]#rename')
  })

  it('throws for unmatched gh command', async () => {
    await expect(resolveCommand(ghAdapter, ['gh', 'pr', 'merge', '42'])).rejects.toThrow('No adapter operation matched')
  })

  it('throws for wrong executable', async () => {
    await expect(resolveCommand(ghAdapter, ['az', 'repos', 'list'])).rejects.toThrow('expects executable gh, got az')
  })

  it('includes execution context', async () => {
    const result = await resolveCommand(ghAdapter, ['gh', 'repo', 'list', 'openape'])
    expect(result.executionContext.adapter_id).toBe('gh')
    expect(result.executionContext.argv).toEqual(['gh', 'repo', 'list', 'openape'])
    expect(result.executionContext.argv_hash).toMatch(/^SHA-256:/)
    expect(result.executionContext.adapter_digest).toMatch(/^SHA-256:/)
  })
})

describe('resolveCommand with az adapter', () => {
  const azAdapter = loadAdapterFromFile(join(ADAPTERS_DIR, 'az.toml'))

  it('resolves az repos list', async () => {
    const result = await resolveCommand(azAdapter, ['az', 'repos', 'list', '--org', 'https://dev.azure.com/myorg', '--project', 'myproj'])
    expect(result.detail.operation_id).toBe('repos.list')
    expect(result.permission).toBe('az.organization[url=https://dev.azure.com/myorg].project[name=myproj].repo[*]#list')
  })

  it('resolves az repos pr list', async () => {
    const result = await resolveCommand(azAdapter, ['az', 'repos', 'pr', 'list', '--org', 'https://dev.azure.com/myorg', '--project', 'myproj', '--repository', 'myrepo'])
    expect(result.detail.operation_id).toBe('repos.pr.list')
    expect(result.detail.action).toBe('list')
    expect(result.permission).toContain('pull-request[*]#list')
  })

  it('resolves az repos pr create (high risk)', async () => {
    const result = await resolveCommand(azAdapter, [
      'az', 'repos', 'pr', 'create',
      '--org', 'https://dev.azure.com/myorg',
      '--project', 'myproj',
      '--repository', 'myrepo',
      '--source-branch', 'feat/x',
      '--target-branch', 'main',
    ])
    expect(result.detail.operation_id).toBe('repos.pr.create')
    expect(result.detail.risk).toBe('high')
    expect(result.detail.constraints).toEqual({ exact_command: true })
  })
})

describe('resolveCommand with exo adapter', () => {
  const exoAdapter = loadAdapterFromFile(join(ADAPTERS_DIR, 'exo.toml'))

  it('resolves exo dns list', async () => {
    const result = await resolveCommand(exoAdapter, ['exo', 'dns', 'list'])
    expect(result.detail.operation_id).toBe('dns.list')
    expect(result.permission).toBe('exo.account[name=current].dns-domain[*]#list')
  })

  it('resolves exo dns show (domain)', async () => {
    const result = await resolveCommand(exoAdapter, ['exo', 'dns', 'show', 'example.com'])
    expect(result.detail.operation_id).toBe('dns.show')
    expect(result.permission).toBe('exo.account[name=current].dns-domain[name=example.com].dns-record[*]#list')
  })

  it('resolves exo dns show with --name (specific record)', async () => {
    const result = await resolveCommand(exoAdapter, ['exo', 'dns', 'show', 'example.com', '--name', 'www'])
    expect(result.detail.operation_id).toBe('dns.show.record')
    expect(result.permission).toBe('exo.account[name=current].dns-domain[name=example.com].dns-record[name=www]#read')
  })

  it('resolves exo dns remove (high risk)', async () => {
    const result = await resolveCommand(exoAdapter, ['exo', 'dns', 'remove', 'example.com', 'www'])
    expect(result.detail.operation_id).toBe('dns.remove')
    expect(result.detail.risk).toBe('high')
    expect(result.permission).toBe('exo.account[name=current].dns-domain[name=example.com].dns-record[name=www]#delete')
  })
})

describe('createFallbackCommand', () => {
  it('creates fallback for unknown commands', async () => {
    const fallback = await createFallbackCommand('unknown-tool do-something')
    expect(fallback.permission).toMatch(/^unknown\.command\[hash=/)
    expect(fallback.display).toBe('Execute: unknown-tool do-something')
    expect(fallback.risk).toBe('high')
    expect(fallback.hash).toMatch(/^SHA-256:/)
  })

  it('truncates long commands in display', async () => {
    const longCmd = 'some-tool ' + 'a'.repeat(100)
    const fallback = await createFallbackCommand(longCmd)
    expect(fallback.display.length).toBeLessThanOrEqual(70)
    expect(fallback.display).toContain('...')
  })
})

describe('resolveCommandFromAdapters', () => {
  const adapters = [
    loadAdapterFromFile(join(ADAPTERS_DIR, 'gh.toml')),
    loadAdapterFromFile(join(ADAPTERS_DIR, 'az.toml')),
    loadAdapterFromFile(join(ADAPTERS_DIR, 'exo.toml')),
  ]

  it('resolves known command to adapter', async () => {
    const result = await resolveCommandFromAdapters(adapters, 'gh repo list openape')
    expect(result.resolved).not.toBeNull()
    expect(result.fallback).toBeNull()
    expect(result.resolved!.detail.cli_id).toBe('gh')
  })

  it('falls back for unknown executable', async () => {
    const result = await resolveCommandFromAdapters(adapters, 'npm publish')
    expect(result.resolved).toBeNull()
    expect(result.fallback).not.toBeNull()
    expect(result.fallback!.risk).toBe('high')
  })

  it('falls back for known executable but unknown operation', async () => {
    const result = await resolveCommandFromAdapters(adapters, 'gh unknown-command')
    expect(result.resolved).toBeNull()
    expect(result.fallback).not.toBeNull()
  })

  it('throws for empty command', async () => {
    await expect(resolveCommandFromAdapters(adapters, '')).rejects.toThrow('Empty command')
  })
})
