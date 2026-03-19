import { describe, expect, it } from 'vitest'
import {
  canonicalizeCliPermission,
  cliAuthorizationDetailCovers,
  computeArgvHash,
  validateCliAuthorizationDetail,
} from '../validation/index.js'

describe('cli grant helpers', () => {
  const detail = {
    type: 'openape_cli' as const,
    cli_id: 'gh',
    operation_id: 'repo.list',
    resource_chain: [
      { resource: 'owner', selector: { login: 'openape' } },
      { resource: 'repo' },
    ],
    action: 'list',
    permission: 'gh.owner[login=openape].repo[*]#list',
    display: 'List repositories for owner openape',
    risk: 'low' as const,
  }

  it('canonicalizes resource chains into permissions', () => {
    expect(canonicalizeCliPermission(detail)).toBe('gh.owner[login=openape].repo[*]#list')
  })

  it('validates canonical permission alignment', () => {
    expect(validateCliAuthorizationDetail(detail).valid).toBe(true)
    expect(validateCliAuthorizationDetail({ ...detail, permission: 'wrong' }).valid).toBe(false)
  })

  it('checks coverage between wildcard and concrete details', () => {
    const granted = detail
    const required: typeof detail = {
      ...detail,
      resource_chain: [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo', selector: { name: 'cli' } },
      ] as typeof detail.resource_chain,
      permission: 'gh.owner[login=openape].repo[name=cli]#list',
    }

    expect(cliAuthorizationDetailCovers(granted, required)).toBe(true)
    expect(cliAuthorizationDetailCovers(required, granted)).toBe(false)
  })

  it('hashes argv deterministically', async () => {
    const first = await computeArgvHash(['gh', 'repo', 'list', 'openape'])
    const second = await computeArgvHash(['gh', 'repo', 'list', 'openape'])
    expect(first).toBe(second)
    expect(first).toMatch(/^SHA-256:/)
  })
})
