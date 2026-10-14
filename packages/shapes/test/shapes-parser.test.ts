import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadAdapter } from '../src/adapters.js'
import { resolveCommand } from '../src/parser.js'
import { parseAdapterToml } from '../src/toml.js'

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

describe('declared options in adapter TOML', () => {
  const adapter = (cli: string, operation: string) => `schema = "openape-shapes/v1"
[cli]
id = "git"
executable = "git"
${cli}
[[operation]]
id = "git.merge-base"
command = ["merge-base"]
positionals = ["commit", "other"]
display = "Merge base of {commit} and {other} in {repo}"
action = "read"
risk = "low"
resource_chain = ["repo:path={repo}"]
${operation}
`

  it('copies [cli] global_options onto every operation and keeps value_options', () => {
    const parsed = parseAdapterToml(adapter('global_options = ["C=repo"]', 'value_options = []\nflag_options = ["is-ancestor"]'))

    expect(parsed.operations[0]).toMatchObject({ global_options: ['C=repo'], value_options: [], flag_options: ['is-ancestor'] })
  })

  it('resolves git -C <repo> merge-base --is-ancestor A B', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'shapes-options-')), 'git.toml')
    writeFileSync(file, adapter('global_options = ["C=repo"]', 'flag_options = ["is-ancestor"]'))

    const resolved = await resolveCommand(loadAdapter('git', file), ['git', '-C', '/work/repo', 'merge-base', '--is-ancestor', 'A', 'B'])

    expect(resolved.bindings).toEqual({ 'is-ancestor': 'true', 'commit': 'A', 'other': 'B', 'repo': '/work/repo' })
    expect(resolved.permission).toBe('git.repo[path=/work/repo]#read')
    expect(resolved.detail.display).toBe('Merge base of A and B in /work/repo')
  })

  it('rejects malformed option declarations', () => {
    expect(() => parseAdapterToml(adapter('global_options = ["C=re po"]', ''))).toThrow(/invalid global_options/)
    expect(() => parseAdapterToml(adapter('', 'value_options = ["onto=x"]'))).toThrow(/invalid value_options/)
    expect(() => parseAdapterToml(adapter('', 'flag_options = ["a b"]'))).toThrow(/invalid flag_options/)
  })
})

describe('registry presentation and tested versions', () => {
  const adapter = (cli: string, operation: string) => `schema = "openape-shapes/v1"
[cli]
id = "git"
executable = "git"
global_options = ["C=repo"]
${cli}
[[operation]]
id = "git.push.refspec"
command = ["push"]
positionals = ["remote", "refspec"]
value_options = []
flag_options = ["force-with-lease"]
display = "Push {refspec} to {remote}"
action = "push"
risk = "high"
exact_command = true
resource_chain = ["repo:*", "remote:name={remote}"]
${operation}
`
  const versions = 'tested_versions = ["2.54"]\nversion_command = ["--version"]\nversion_pattern = \'^git version (\\d+\\.\\d+)\''
  const presentation = `[operation.presentation]
title = { de = "{refspec} nach {remote} pushen", en = "Push {refspec} to {remote}" }

[operation.presentation.consequence]
allows = { de = "Erlaubt genau diesen Push.", en = "Allows exactly this push." }

[[operation.presentation.facts]]
label = { de = "Repository", en = "Repository" }
binding = "repo"
format = "code"
`

  it('parses tested versions on [cli] and presentation sub-tables of an operation', () => {
    const parsed = parseAdapterToml(adapter(versions, presentation))

    expect(parsed.cli).toMatchObject({ tested_versions: ['2.54'], version_command: ['--version'], version_pattern: '^git version (\\d+\\.\\d+)' })
    expect(parsed.operations[0]!.presentation).toEqual({
      title: { de: '{refspec} nach {remote} pushen', en: 'Push {refspec} to {remote}' },
      consequence: { allows: { de: 'Erlaubt genau diesen Push.', en: 'Allows exactly this push.' } },
      facts: [{ label: { de: 'Repository', en: 'Repository' }, binding: 'repo', format: 'code' }],
    })
  })

  it('keeps the resolved grant detail independent of the presentation', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'shapes-presentation-')), 'git.toml')
    writeFileSync(file, adapter(versions, presentation))
    const plain = join(mkdtempSync(join(tmpdir(), 'shapes-presentation-')), 'git.toml')
    writeFileSync(plain, adapter('', ''))
    const argv = ['git', '-C', '/work/repo', 'push', 'origin', 'HEAD:refs/heads/topic']

    const withPresentation = await resolveCommand(loadAdapter('git', file), argv)
    const withoutPresentation = await resolveCommand(loadAdapter('git', plain), argv)

    expect(withPresentation.detail).toEqual(withoutPresentation.detail)
    expect(withPresentation.digest).not.toBe(withoutPresentation.digest)
  })

  it.each([
    ['an unknown root key', `trusted = true\n${adapter('', '')}`, /Adapter has unknown key\(s\): trusted/],
    ['an unknown [cli] key', adapter('help = ["-h"]', ''), /Adapter cli has unknown key\(s\): help/],
    ['an unknown operation key', adapter('', 'notes = "x"'), /Operation git\.push\.refspec has unknown key\(s\): notes/],
    ['an unknown presentation key', adapter('', `${presentation}\n[operation.presentation.extra]\nx = 1`), /presentation has unknown key\(s\): extra/],
    ['a presentation binding the operation never binds', adapter('', '[operation.presentation]\ntitle = { de = "{branch}", en = "{branch}" }'), /references \{branch\}/],
    ['an optional binding in the title', adapter('', '[operation.presentation]\ntitle = { de = "{repo}", en = "{repo}" }'), /references \{repo\}/],
    ['partial version fields', adapter('tested_versions = ["2.54"]', ''), /together/],
    ['an invalid risk', adapter('', '').replace('risk = "high"', 'risk = "severe"'), /invalid risk/],
    ['a non-boolean exact_command', adapter('', '').replace('exact_command = true', 'exact_command = "yes"'), /invalid exact_command/],
    ['invalid TOML', adapter('', 'display = "duplicate"'), /.+/],
  ])('fails closed on %s', (_, content, message) => {
    expect(() => parseAdapterToml(content)).toThrow(message)
  })

  it('keeps the original reading of comma-separated array strings', () => {
    const parsed = parseAdapterToml(adapter('', '').replace('"remote:name={remote}"', '"remote:name={remote},kind=git"'))

    expect(parsed.operations[0]!.resource_chain).toEqual(['repo:*', 'remote:name={remote}', 'kind=git'])
  })
})
