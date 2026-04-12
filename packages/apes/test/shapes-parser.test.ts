import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadAdapter } from '../src/shapes/adapters.js'
import { resolveCommand } from '../src/shapes/parser.js'

const fixturesDir = join(import.meta.dirname, 'fixtures')

describe('@openape/shapes adapters', () => {
  it('resolves gh repo list', async () => {
    const loaded = loadAdapter('gh', join(fixturesDir, 'gh.toml'))
    const resolved = await resolveCommand(loaded, ['gh', 'repo', 'list', 'openape'])

    expect(resolved.detail.operation_id).toBe('repo.list')
    expect(resolved.permission).toBe('gh.owner[login=openape].repo[*]#list')
  })

  it('resolves az repos pr list with explicit bindings', async () => {
    const loaded = loadAdapter('az', join(fixturesDir, 'az.toml'))
    const resolved = await resolveCommand(loaded, [
      'az',
      'repos',
      'pr',
      'list',
      '--org',
      'https://dev.azure.com/acme',
      '--project',
      'portal',
      '--repository',
      'api',
    ])

    expect(resolved.detail.operation_id).toBe('repos.pr.list')
    expect(resolved.permission).toBe('az.organization[url=https://dev.azure.com/acme].project[name=portal].repo[name=api].pull-request[*]#list')
  })

  it('resolves exo dns show and keeps delete separate', async () => {
    const loaded = loadAdapter('exo', join(fixturesDir, 'exo.toml'))
    const read = await resolveCommand(loaded, ['exo', 'dns', 'show', 'example.com'])
    const remove = await resolveCommand(loaded, ['exo', 'dns', 'remove', 'example.com', 'www'])

    expect(read.permission).toBe('exo.account[name=current].dns-domain[name=example.com].dns-record[*]#list')
    expect(remove.permission).toBe('exo.account[name=current].dns-domain[name=example.com].dns-record[name=www]#delete')
    expect(read.permission).not.toBe(remove.permission)
  })

  it('resolves grep -r (single short flag)', async () => {
    const loaded = loadAdapter('grep', join(fixturesDir, 'grep.toml'))
    const resolved = await resolveCommand(loaded, ['grep', '-r', 'TODO', '/src'])

    expect(resolved.detail.operation_id).toBe('grep.search-recursive')
  })

  it('resolves grep -rl (combined short flags)', async () => {
    const loaded = loadAdapter('grep', join(fixturesDir, 'grep.toml'))
    const resolved = await resolveCommand(loaded, ['grep', '-rl', 'TODO', '/src'])

    expect(resolved.detail.operation_id).toBe('grep.search-recursive')
  })

  it('resolves find -name (short option with value)', async () => {
    const loaded = loadAdapter('find', join(fixturesDir, 'find.toml'))
    const resolved = await resolveCommand(loaded, ['find', '/src', '-name', '*.md'])

    expect(resolved.detail.operation_id).toBe('find.by-name')
  })

  it('resolves find -type (short option with value)', async () => {
    const loaded = loadAdapter('find', join(fixturesDir, 'find.toml'))
    const resolved = await resolveCommand(loaded, ['find', '/tmp', '-type', 'f'])

    expect(resolved.detail.operation_id).toBe('find.by-type')
  })

  describe('literal positionals (interleaved keywords)', () => {
    it('disambiguates iurio task show vs archive vs remove', async () => {
      const loaded = loadAdapter('iurio', join(fixturesDir, 'iurio.toml'))

      const show = await resolveCommand(loaded, ['iurio', 'project', '42', 'workspace', '7', 'task', '123', 'show'])
      const archive = await resolveCommand(loaded, ['iurio', 'project', '42', 'workspace', '7', 'task', '123', 'archive'])
      const remove = await resolveCommand(loaded, ['iurio', 'project', '42', 'workspace', '7', 'task', '123', 'remove'])

      expect(show.detail.operation_id).toBe('task.show')
      expect(archive.detail.operation_id).toBe('task.archive')
      expect(remove.detail.operation_id).toBe('task.remove')
      expect(show.permission).not.toBe(archive.permission)
      expect(archive.permission).not.toBe(remove.permission)
    })

    it('binds only non-literal positionals', async () => {
      const loaded = loadAdapter('iurio', join(fixturesDir, 'iurio.toml'))
      const resolved = await resolveCommand(loaded, ['iurio', 'project', '42', 'workspace', '7', 'task', '123', 'archive'])

      expect(resolved.bindings).toEqual({
        project_id: '42',
        workspace_id: '7',
        task_id: '123',
      })
    })

    it('rejects argv whose literal slot does not match', async () => {
      const loaded = loadAdapter('iurio', join(fixturesDir, 'iurio.toml'))

      const wrongWorkspace = resolveCommand(loaded, ['iurio', 'project', '42', 'foo', '7', 'task', '123', 'show'])
      const wrongTask = resolveCommand(loaded, ['iurio', 'project', '42', 'workspace', '7', 'bogus', '123', 'show'])

      await expect(wrongWorkspace).rejects.toThrow(/No adapter operation matched/)
      await expect(wrongTask).rejects.toThrow(/No adapter operation matched/)
    })

    it('still resolves plain-positional adapters (backward compat)', async () => {
      const loaded = loadAdapter('gh', join(fixturesDir, 'gh.toml'))
      const resolved = await resolveCommand(loaded, ['gh', 'repo', 'list', 'openape'])

      expect(resolved.detail.operation_id).toBe('repo.list')
      expect(resolved.bindings.owner).toBe('openape')
    })

    it('resolves iurio workspaces list with literal trailing tokens', async () => {
      const loaded = loadAdapter('iurio', join(fixturesDir, 'iurio.toml'))
      const resolved = await resolveCommand(loaded, ['iurio', 'project', '42', 'workspaces', 'list'])

      expect(resolved.detail.operation_id).toBe('workspaces.list')
      expect(resolved.bindings).toEqual({ project_id: '42' })
    })
  })
})
