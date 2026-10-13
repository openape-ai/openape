import { describe, expect, it } from 'vitest'
import { buildCliAuthDetail, matchArgvToOperation } from '../shape-matcher.js'
import type { ShapeMatchOperation } from '../shape-matcher.js'

const ops: ShapeMatchOperation[] = [
  {
    id: 'gh.repo.list',
    command: ['repo', 'list'],
    positionals: ['owner'],
    display: 'List repos for {owner}',
    action: 'list',
    risk: 'low',
    resource_chain: ['owner:login={owner}', 'repo:*'],
  },
  {
    id: 'gh.repo.delete',
    command: ['repo', 'delete'],
    positionals: ['slug'],
    required_options: ['confirm'],
    display: 'Delete {slug}',
    action: 'delete',
    risk: 'high',
    resource_chain: ['repo:name={slug}'],
    exact_command: true,
  },
]

describe('matchArgvToOperation', () => {
  it('matches a command prefix + positional binding', () => {
    const m = matchArgvToOperation(ops, ['repo', 'list', 'openape'])
    expect(m?.operation.id).toBe('gh.repo.list')
    expect(m?.bindings.owner).toBe('openape')
  })

  it('returns null when nothing matches', () => {
    expect(matchArgvToOperation(ops, ['issue', 'list'])).toBeNull()
  })

  it('enforces required_options', () => {
    expect(matchArgvToOperation(ops, ['repo', 'delete', 'a/b'])).toBeNull()
    const m = matchArgvToOperation(ops, ['repo', 'delete', 'a/b', '--confirm'])
    expect(m?.operation.id).toBe('gh.repo.delete')
  })

  it('parses --k=v and --k v options into bindings', () => {
    const m = matchArgvToOperation(
      [{ id: 'x', command: ['run'], display: 'd', action: 'exec', risk: 'low', resource_chain: [], required_options: ['env'] }],
      ['run', '--env=prod'],
    )
    expect(m?.bindings.env).toBe('prod')
  })

  it('expands combined single-letter flags (-rl → -r -l)', () => {
    const m = matchArgvToOperation(
      [{ id: 'ls', command: ['ls'], display: 'd', action: 'list', risk: 'low', resource_chain: [], required_options: ['r', 'l'] }],
      ['ls', '-rl'],
    )
    expect(m?.operation.id).toBe('ls')
  })

  it('prefers the most specific (longest command prefix) match', () => {
    const two: ShapeMatchOperation[] = [
      { id: 'a', command: ['repo'], display: 'd', action: 'x', risk: 'low', resource_chain: [] },
      { id: 'b', command: ['repo', 'list'], display: 'd', action: 'x', risk: 'low', resource_chain: [] },
    ]
    expect(matchArgvToOperation(two, ['repo', 'list'])?.operation.id).toBe('b')
  })
})

describe('declared value options', () => {
  const mergeBase: ShapeMatchOperation = { id: 'merge-base', command: ['merge-base'], positionals: ['commit', 'other'], display: '{commit} {other}', action: 'read', risk: 'low', resource_chain: ['repo:*'] }

  it('keeps the legacy rule without value_options: an undeclared long option swallows the next token', () => {
    expect(matchArgvToOperation([mergeBase], ['merge-base', '--is-ancestor', 'A', 'B'])).toBeNull()
    expect(matchArgvToOperation([{ ...mergeBase, positionals: ['other'] }], ['merge-base', '--is-ancestor', 'A', 'B'])?.bindings)
      .toEqual({ 'is-ancestor': 'A', 'other': 'B' })
  })

  it('keeps declared flag_options as flags so positionals stay positionals', () => {
    const match = matchArgvToOperation([{ ...mergeBase, value_options: [], flag_options: ['is-ancestor'] }], ['merge-base', '--is-ancestor', 'A', 'B'])
    expect(match?.bindings).toEqual({ 'is-ancestor': 'true', 'commit': 'A', 'other': 'B' })
  })

  it('fails closed on any undeclared option once options are declared', () => {
    const fetch: ShapeMatchOperation = { id: 'fetch', command: ['fetch'], positionals: ['remote'], value_options: [], flag_options: ['prune'], display: 'Fetch', action: 'read', risk: 'low', resource_chain: ['repo:*'] }
    expect(matchArgvToOperation([fetch], ['fetch', '--prune', 'origin'])?.operation.id).toBe('fetch')
    for (const argv of [
      ['fetch', '--upload-pack=x', 'origin'],
      ['fetch', '--upload-pack', 'x', 'origin'],
      ['fetch', 'origin', '--upload-pack', 'x'],
      ['fetch', '-u', 'x', 'origin'],
      ['fetch', '-c', 'core.sshCommand=x', 'origin'],
      ['fetch', '--exec=x', 'origin'],
      ['fetch', '-pu', 'origin'],
      ['fetch', '--', 'origin'],
    ]) {
      expect(matchArgvToOperation([fetch], argv), argv.join(' ')).toBeNull()
    }
  })

  it('also declares options with flag_options alone', () => {
    const operation: ShapeMatchOperation = { ...mergeBase, flag_options: ['is-ancestor'] }
    expect(matchArgvToOperation([operation], ['merge-base', '--is-ancestor', 'A', 'B'])?.bindings.commit).toBe('A')
    expect(matchArgvToOperation([operation], ['merge-base', '--upload-pack', 'A', 'B'])).toBeNull()
  })

  it('binds values for value_options and required_options only', () => {
    const operation: ShapeMatchOperation = { ...mergeBase, value_options: ['onto'], required_options: ['m'], flag_options: ['quiet'] }
    expect(matchArgvToOperation([operation], ['merge-base', '--onto', 'X', '-m', 'msg', '--quiet', 'A', 'B'])?.bindings)
      .toEqual({ onto: 'X', m: 'msg', quiet: 'true', commit: 'A', other: 'B' })
    expect(matchArgvToOperation([operation], ['merge-base', '--onto=X', '-m', 'msg', 'A', 'B'])?.bindings.onto).toBe('X')
  })
})

describe('global options', () => {
  const status: ShapeMatchOperation = { id: 'status', command: ['status'], global_options: ['C=repo'], display: 'Status', action: 'read', risk: 'low', resource_chain: ['repo:path={repo}'] }

  it('consumes declared global options before the command prefix and binds them', () => {
    const match = matchArgvToOperation([status], ['-C', '/work/repo', 'status'])
    expect(match?.bindings).toEqual({ repo: '/work/repo' })
    expect(buildCliAuthDetail('git', match!.operation, match!.bindings).permission).toBe('git.repo[path=/work/repo]#read')
  })

  it('keeps matching without the global option', () => {
    expect(matchArgvToOperation([status], ['status'])?.operation.id).toBe('status')
  })

  it('rejects undeclared leading options and a global option without value', () => {
    expect(matchArgvToOperation([status], ['-c', 'core.sshCommand=x', 'status'])).toBeNull()
    expect(matchArgvToOperation([status], ['-C', '--', 'status'])).toBeNull()
    expect(matchArgvToOperation([status], ['-C'])).toBeNull()
  })

  it('rejects a repeated global option', () => {
    expect(matchArgvToOperation([status], ['-C', '/work', '-C', 'repo', 'status'])).toBeNull()
    expect(matchArgvToOperation([{ ...status, global_options: ['git-dir'] }], ['--git-dir=/a', '--git-dir', '/b', 'status'])).toBeNull()
  })

  it('never lets an operation option or positional replace a global binding', () => {
    expect(matchArgvToOperation([{ ...status, positionals: ['repo'] }], ['-C', '/secret', 'status', '/allowed'])).toBeNull()
    expect(matchArgvToOperation([status], ['-C', '/secret', 'status', '--repo', '/allowed'])).toBeNull()
  })

  it('uses the option name as binding when no binding is given', () => {
    expect(matchArgvToOperation([{ ...status, global_options: ['git-dir'] }], ['--git-dir=/x/.git', 'status'])?.bindings)
      .toEqual({ 'git-dir': '/x/.git' })
  })
})

describe('buildCliAuthDetail', () => {
  it('builds a detail with rendered display, resource chain, and a canonical permission', () => {
    const m = matchArgvToOperation(ops, ['repo', 'list', 'openape'])!
    const detail = buildCliAuthDetail('gh', m.operation, m.bindings)
    expect(detail.type).toBe('openape_cli')
    expect(detail.cli_id).toBe('gh')
    expect(detail.operation_id).toBe('gh.repo.list')
    expect(detail.display).toBe('List repos for openape')
    expect(detail.resource_chain).toEqual([{ resource: 'owner', selector: { login: 'openape' } }, { resource: 'repo' }])
    expect(detail.permission.length).toBeGreaterThan(0)
  })

  it('sets exact_command constraint when the operation requires it', () => {
    const m = matchArgvToOperation(ops, ['repo', 'delete', 'a/b', '--confirm'])!
    const detail = buildCliAuthDetail('gh', m.operation, m.bindings)
    expect(detail.constraints?.exact_command).toBe(true)
  })
})
