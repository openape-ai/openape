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
