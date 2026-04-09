import type { OpenApeCliAuthorizationDetail, OpenApeCliResourceRef } from '@openape/core'
import { describe, expect, it } from 'vitest'
import { canonicalizeCliPermission } from '../cli-permissions.js'
import {
  buildWideningSuggestionsForGrant,
  suggestWideningsForDetail,
} from '../widening-suggestions.js'

function mockDetail(
  resource: string,
  selector: Record<string, string> | undefined,
  overrides: Partial<OpenApeCliAuthorizationDetail> = {},
): OpenApeCliAuthorizationDetail {
  const chain: OpenApeCliResourceRef[] = [
    selector ? { resource, selector } : { resource },
  ]
  const base: Omit<OpenApeCliAuthorizationDetail, 'permission'> & { permission?: string } = {
    type: 'openape_cli',
    cli_id: 'rm',
    operation_id: 'remove',
    resource_chain: chain,
    action: 'delete',
    display: `Remove ${selector?.path ?? '(unspecified)'}`,
    risk: 'medium',
    ...overrides,
  }
  return {
    ...base,
    permission: canonicalizeCliPermission(base),
  } as OpenApeCliAuthorizationDetail
}

describe('suggestWideningsForDetail', () => {
  it('returns exact + sibling-type + directory + subtree + wildcard for a file with extension', () => {
    const detail = mockDetail('filesystem', { path: '/tmp/foo.txt' })
    const suggestions = suggestWideningsForDetail(detail)
    const paths = suggestions.map(s =>
      s.detail.resource_chain[0]!.selector?.path ?? '<none>',
    )
    expect(paths).toEqual(['/tmp/foo.txt', '/tmp/*.txt', '/tmp/*', '/tmp/**', '<none>'])
    expect(suggestions.map(s => s.scope)).toEqual([
      'exact',
      'sibling-type',
      'directory',
      'subtree',
      'wildcard',
    ])
  })

  it('drops sibling-type for files without extension', () => {
    const detail = mockDetail('filesystem', { path: '/tmp/README' })
    const scopes = suggestWideningsForDetail(detail).map(s => s.scope)
    expect(scopes).not.toContain('sibling-type')
    expect(scopes).toContain('directory')
    expect(scopes).toContain('subtree')
    expect(scopes[0]).toBe('exact')
    expect(scopes.at(-1)).toBe('wildcard')
  })

  it('drops sibling-type for dotfiles (no real extension)', () => {
    const detail = mockDetail('filesystem', { path: '/home/me/.bashrc' })
    const scopes = suggestWideningsForDetail(detail).map(s => s.scope)
    expect(scopes).not.toContain('sibling-type')
  })

  it('generates intermediate ancestors for deep paths', () => {
    const detail = mockDetail('filesystem', { path: '/a/b/c/d.txt' })
    const paths = suggestWideningsForDetail(detail).map(
      s => s.detail.resource_chain[0]!.selector?.path,
    )
    // Expect the subtree ladder to include each ancestor
    expect(paths).toContain('/a/b/c/**')
    expect(paths).toContain('/a/b/**')
    expect(paths).toContain('/a/**')
  })

  it('never suggests root / or /** as a subtree', () => {
    const detail = mockDetail('filesystem', { path: '/etc/passwd' })
    const paths = suggestWideningsForDetail(detail).map(
      s => s.detail.resource_chain[0]!.selector?.path ?? '<none>',
    )
    expect(paths).not.toContain('/')
    expect(paths).not.toContain('/**')
  })

  it('handles non-path selectors with only exact + full wildcard', () => {
    const detail = mockDetail('repository', { name: 'openape' })
    const suggestions = suggestWideningsForDetail(detail)
    expect(suggestions).toHaveLength(2)
    expect(suggestions[0]!.scope).toBe('exact')
    expect(suggestions[1]!.scope).toBe('wildcard')
    // Wildcard drops the selector entirely
    expect(suggestions[1]!.detail.resource_chain[0]!.selector).toBeUndefined()
  })

  it('handles missing selector entirely', () => {
    const detail = mockDetail('filesystem', undefined)
    const suggestions = suggestWideningsForDetail(detail)
    expect(suggestions.length).toBeGreaterThanOrEqual(1)
    expect(suggestions[0]!.scope).toBe('exact')
  })

  it('preserves non-path selector entries elsewhere in the chain', () => {
    const detail: OpenApeCliAuthorizationDetail = {
      type: 'openape_cli',
      cli_id: 'rm',
      operation_id: 'remove',
      resource_chain: [
        { resource: 'host', selector: { hostname: 'dev-box' } },
        { resource: 'filesystem', selector: { path: '/tmp/foo.txt' } },
      ],
      action: 'delete',
      permission: '',
      display: 'Remove /tmp/foo.txt on dev-box',
      risk: 'medium',
    }
    detail.permission = canonicalizeCliPermission(detail)
    const suggestions = suggestWideningsForDetail(detail)
    suggestions.forEach((s) => {
      expect(s.detail.resource_chain[0]!.selector).toEqual({ hostname: 'dev-box' })
    })
  })

  it('computes correct canonical permission strings for each suggestion', () => {
    const detail = mockDetail('filesystem', { path: '/tmp/foo.txt' })
    const suggestions = suggestWideningsForDetail(detail)
    suggestions.forEach((s) => {
      expect(s.detail.permission).toBe(s.permission)
      expect(s.permission).toMatch(/^rm\./)
      expect(s.permission).toMatch(/#delete$/)
    })
  })

  it('recognizes glob selector key as path-like', () => {
    const detail = mockDetail('filesystem', { glob: '/var/log/app.log' })
    const scopes = suggestWideningsForDetail(detail).map(s => s.scope)
    expect(scopes).toContain('directory')
    expect(scopes).toContain('subtree')
    expect(scopes).toContain('sibling-type')
  })

  it('handles relative paths without absolute prefix', () => {
    const detail = mockDetail('filesystem', { path: 'src/lib/foo.ts' })
    const paths = suggestWideningsForDetail(detail).map(
      s => s.detail.resource_chain[0]!.selector?.path,
    )
    // Relative paths should still produce variants, without leading slash
    expect(paths).toContain('src/lib/*.ts')
    expect(paths).toContain('src/lib/**')
    expect(paths?.some(p => p?.startsWith('/'))).toBe(false)
  })

  it('single-segment absolute path only offers exact and wildcard', () => {
    // /foo has no parent → no directory/subtree variants, only exact + wildcard
    const detail = mockDetail('filesystem', { path: '/foo' })
    const scopes = suggestWideningsForDetail(detail).map(s => s.scope)
    expect(scopes).toEqual(['exact', 'wildcard'])
  })

  it('handles empty path selector gracefully', () => {
    const detail = mockDetail('filesystem', { path: '' })
    const suggestions = suggestWideningsForDetail(detail)
    // Empty path produces no variants; exact is omitted from deduplication but wildcard stays
    expect(suggestions.length).toBeGreaterThanOrEqual(1)
    expect(suggestions[0]!.scope).toBe('exact')
  })

  it('exact suggestion has matching permission to original detail', () => {
    const detail = mockDetail('filesystem', { path: '/tmp/foo.txt' })
    const [exact] = suggestWideningsForDetail(detail)
    expect(exact!.permission).toBe(detail.permission)
  })

  it('filters duplicate exact when path variant equals original', () => {
    // Edge case: deriving variants for "a/*.txt" would include the same pattern as original
    // for certain inputs — ensure no duplicate
    const detail = mockDetail('filesystem', { path: '/tmp/*.txt' })
    const suggestions = suggestWideningsForDetail(detail)
    const patterns = suggestions.map(s => s.detail.resource_chain[0]!.selector?.path)
    const unique = new Set(patterns)
    expect(patterns.length).toBe(unique.size)
  })
})

describe('buildWideningSuggestionsForGrant', () => {
  it('returns one suggestion list per detail', () => {
    const a = mockDetail('filesystem', { path: '/tmp/a.txt' })
    const b = mockDetail('filesystem', { path: '/var/log/b.log' })
    const result = buildWideningSuggestionsForGrant([a, b])
    expect(result).toHaveLength(2)
    expect(result[0]![0]!.scope).toBe('exact')
    expect(result[1]![0]!.scope).toBe('exact')
    // distinct paths are preserved per detail
    expect(result[0]![0]!.detail.resource_chain[0]!.selector?.path).toBe('/tmp/a.txt')
    expect(result[1]![0]!.detail.resource_chain[0]!.selector?.path).toBe('/var/log/b.log')
  })

  it('handles empty input', () => {
    expect(buildWideningSuggestionsForGrant([])).toEqual([])
  })
})
