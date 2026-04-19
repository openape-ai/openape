import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { describe, expect, it } from 'vitest'
import {
  canonicalizeCliPermission,
  cliAuthorizationDetailCovers,
  selectorValueMatches,
} from '../src/cli-permissions.js'

function detail(overrides: Partial<OpenApeCliAuthorizationDetail> = {}): OpenApeCliAuthorizationDetail {
  const base: OpenApeCliAuthorizationDetail = {
    type: 'openape_cli',
    cli_id: 'ls',
    operation_id: 'ls.list',
    action: 'read',
    risk: 'low',
    resource_chain: [],
    permission: '',
    display: 'ls',
    ...overrides,
  }
  base.permission = canonicalizeCliPermission(base)
  return base
}

describe('selectorValueMatches', () => {
  it('matches literal values with string equality (no glob)', () => {
    expect(selectorValueMatches('openape', 'openape')).toBe(true)
    expect(selectorValueMatches('openape', 'openapi')).toBe(false)
    expect(selectorValueMatches('', '')).toBe(true)
  })

  it('prefix glob: "foo/*" matches anything starting with "foo/"', () => {
    expect(selectorValueMatches('/Users/patrickhofmann/*', '/Users/patrickhofmann/Documents')).toBe(true)
    expect(selectorValueMatches('/Users/patrickhofmann/*', '/Users/patrickhofmann/')).toBe(true)
    expect(selectorValueMatches('/Users/patrickhofmann/*', '/Users/other/foo')).toBe(false)
  })

  it('suffix glob: "*.ts" matches anything ending in ".ts"', () => {
    expect(selectorValueMatches('*.ts', 'index.ts')).toBe(true)
    expect(selectorValueMatches('*.ts', 'index.tsx')).toBe(false)
  })

  it('middle glob: "repo/*/src" matches anything with that prefix+suffix', () => {
    expect(selectorValueMatches('repo/*/src', 'repo/openape/src')).toBe(true)
    expect(selectorValueMatches('repo/*/src', 'repo/openape/lib/src')).toBe(true)
    expect(selectorValueMatches('repo/*/src', 'repo/openape/lib')).toBe(false)
  })

  it('multiple globs: "*-*-*"', () => {
    expect(selectorValueMatches('*-*-*', 'a-b-c')).toBe(true)
    expect(selectorValueMatches('*-*-*', 'ab')).toBe(false)
  })

  it('empty glob pattern "*" matches any value including empty string', () => {
    expect(selectorValueMatches('*', 'anything')).toBe(true)
    expect(selectorValueMatches('*', '')).toBe(true)
  })

  it('escapes regex metachars so literal "." is not "any char"', () => {
    expect(selectorValueMatches('a.b', 'aXb')).toBe(false)
    expect(selectorValueMatches('a.b', 'a.b')).toBe(true)
  })

  it('escapes other regex specials (+, ?, (, [, etc.) when used literally', () => {
    expect(selectorValueMatches('a+b', 'a+b')).toBe(true)
    expect(selectorValueMatches('a+b', 'aab')).toBe(false)
    expect(selectorValueMatches('a(b)c', 'a(b)c')).toBe(true)
    expect(selectorValueMatches('a[b]c', 'a[b]c')).toBe(true)
  })

  it('caps at 256 chars (rejects overly long patterns)', () => {
    const long = '*'.repeat(257)
    expect(selectorValueMatches(long, 'any')).toBe(false)
  })
})

describe('cliAuthorizationDetailCovers — literal (unchanged backward-compat)', () => {
  it('same cli+action+empty-chain covers any required chain', () => {
    const granted = detail({ resource_chain: [] })
    const required = detail({ resource_chain: [{ resource: 'fs', selector: { path: '/tmp' } }] })
    expect(cliAuthorizationDetailCovers(granted, required)).toBe(true)
  })

  it('literal selector value must equal required exactly', () => {
    const granted = detail({ resource_chain: [{ resource: 'repo', selector: { name: 'openape' } }] })
    const good = detail({ resource_chain: [{ resource: 'repo', selector: { name: 'openape' } }] })
    const bad = detail({ resource_chain: [{ resource: 'repo', selector: { name: 'openapi' } }] })
    expect(cliAuthorizationDetailCovers(granted, good)).toBe(true)
    expect(cliAuthorizationDetailCovers(granted, bad)).toBe(false)
  })

  it('wildcard (undefined selector) covers any required selector on same resource', () => {
    const granted = detail({ resource_chain: [{ resource: 'repo', selector: undefined }] })
    const required = detail({ resource_chain: [{ resource: 'repo', selector: { name: 'anything' } }] })
    expect(cliAuthorizationDetailCovers(granted, required)).toBe(true)
  })
})

describe('cliAuthorizationDetailCovers — glob (Phase 5)', () => {
  it('prefix-glob path matches deeper path', () => {
    const granted = detail({
      resource_chain: [{ resource: 'fs', selector: { path: '/Users/patrickhofmann/*' } }],
    })
    const required = detail({
      resource_chain: [{ resource: 'fs', selector: { path: '/Users/patrickhofmann/Documents/foo.txt' } }],
    })
    expect(cliAuthorizationDetailCovers(granted, required)).toBe(true)
  })

  it('prefix-glob path rejects non-matching path', () => {
    const granted = detail({
      resource_chain: [{ resource: 'fs', selector: { path: '/Users/patrickhofmann/*' } }],
    })
    const required = detail({
      resource_chain: [{ resource: 'fs', selector: { path: '/Users/other/foo' } }],
    })
    expect(cliAuthorizationDetailCovers(granted, required)).toBe(false)
  })

  it('glob applies per-key: other keys still require literal match', () => {
    const granted = detail({
      resource_chain: [{ resource: 'repo', selector: { owner: 'patrick', name: 'open*' } }],
    })
    const goodOwnerGoodName = detail({
      resource_chain: [{ resource: 'repo', selector: { owner: 'patrick', name: 'openape' } }],
    })
    const badOwner = detail({
      resource_chain: [{ resource: 'repo', selector: { owner: 'someone-else', name: 'openape' } }],
    })
    expect(cliAuthorizationDetailCovers(granted, goodOwnerGoodName)).toBe(true)
    expect(cliAuthorizationDetailCovers(granted, badOwner)).toBe(false)
  })

  it('required selector missing the granted key still fails', () => {
    const granted = detail({
      resource_chain: [{ resource: 'fs', selector: { path: '/tmp/*' } }],
    })
    const required = detail({
      resource_chain: [{ resource: 'fs', selector: { other: 'value' } }],
    })
    expect(cliAuthorizationDetailCovers(granted, required)).toBe(false)
  })
})
