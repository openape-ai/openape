import type { OpenApeGrant } from '@openape/core'
import type { StandingGrantRequest } from '@openape/grants'
import { describe, expect, it } from 'vitest'
import {
  formatRelativeTime,
  formatResourceChainTemplate,
  formatStandingGrantScope,
  parseResourceChainInput,
} from '../src/runtime/utils/standing-grants'

function makeSg(overrides: Partial<StandingGrantRequest> = {}): OpenApeGrant {
  const req: StandingGrantRequest = {
    type: 'standing',
    owner: 'patrick@example.com',
    delegate: 'agent@example.com',
    audience: 'shapes',
    resource_chain_template: [],
    grant_type: 'always',
    ...overrides,
  }
  return {
    id: 'sg-1',
    status: 'approved',
    type: 'standing',
    request: req as unknown as OpenApeGrant['request'],
    created_at: 0,
    decided_at: 0,
  }
}

describe('formatResourceChainTemplate', () => {
  it('returns "any resource" for empty chain', () => {
    expect(formatResourceChainTemplate([])).toBe('any resource')
  })
  it('returns "resource (any)" for wildcard resource', () => {
    expect(formatResourceChainTemplate([{ resource: 'repo' }])).toBe('repo (any)')
  })
  it('formats single-selector resource', () => {
    expect(formatResourceChainTemplate([{ resource: 'repo', selector: { owner: 'patrick' } }]))
      .toBe('repo: owner=patrick')
  })
  it('formats multi-selector resource', () => {
    expect(formatResourceChainTemplate([
      { resource: 'repo', selector: { owner: 'patrick', name: 'app' } },
    ])).toBe('repo: owner=patrick, name=app')
  })
  it('joins multiple resources with /', () => {
    expect(formatResourceChainTemplate([
      { resource: 'repo' },
      { resource: 'branch', selector: { name: 'main' } },
    ])).toBe('repo (any) / branch: name=main')
  })
})

describe('formatStandingGrantScope', () => {
  it('renders wildcard CLI, wildcard resources, any-risk, always', () => {
    const sg = makeSg({ cli_id: undefined, resource_chain_template: [], max_risk: undefined, grant_type: 'always' })
    expect(formatStandingGrantScope(sg)).toBe('any CLI (any resource), any risk, always')
  })
  it('renders specific CLI + selector + max_risk + timed', () => {
    const sg = makeSg({
      cli_id: 'git',
      resource_chain_template: [{ resource: 'repo', selector: { owner: 'patrick' } }],
      max_risk: 'high',
      grant_type: 'timed',
      duration: 3600,
    })
    expect(formatStandingGrantScope(sg)).toBe('git (repo: owner=patrick), risk≤high, timed 3600s')
  })
  it('returns "unknown" for non-standing grants', () => {
    const g = { ...makeSg(), request: { type: 'command' } as unknown as OpenApeGrant['request'] }
    expect(formatStandingGrantScope(g)).toBe('unknown')
  })
})

describe('parseResourceChainInput', () => {
  it('returns [] for empty string', () => {
    expect(parseResourceChainInput('')).toEqual([])
  })
  it('returns [] for whitespace-only', () => {
    expect(parseResourceChainInput('\n  \n')).toEqual([])
  })
  it('parses a single wildcard resource', () => {
    expect(parseResourceChainInput('repo')).toEqual([{ resource: 'repo' }])
  })
  it('parses a resource with one selector', () => {
    expect(parseResourceChainInput('repo:owner=patrick')).toEqual([
      { resource: 'repo', selector: { owner: 'patrick' } },
    ])
  })
  it('parses multi-selector', () => {
    expect(parseResourceChainInput('repo:owner=patrick,name=app')).toEqual([
      { resource: 'repo', selector: { owner: 'patrick', name: 'app' } },
    ])
  })
  it('parses multiple lines', () => {
    expect(parseResourceChainInput('repo:owner=patrick\nbranch')).toEqual([
      { resource: 'repo', selector: { owner: 'patrick' } },
      { resource: 'branch' },
    ])
  })
  it('throws on malformed selector segment', () => {
    expect(() => parseResourceChainInput('repo:bad')).toThrow(/needs "key=value"/)
  })
  it('throws on missing resource', () => {
    expect(() => parseResourceChainInput(':owner=patrick')).toThrow(/Missing resource/)
  })
})

describe('formatRelativeTime', () => {
  it('returns em-dash for 0', () => {
    expect(formatRelativeTime(0)).toBe('—')
  })
  it('returns "just now" for recent', () => {
    expect(formatRelativeTime(Math.floor(Date.now() / 1000) - 30)).toBe('just now')
  })
  it('returns minutes for <1h', () => {
    expect(formatRelativeTime(Math.floor(Date.now() / 1000) - 300)).toMatch(/^\d+m ago$/)
  })
})
