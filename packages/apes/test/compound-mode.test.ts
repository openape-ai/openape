import { describe, expect, it } from 'vitest'
import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { compoundCoveredByDetails } from '../src/shapes/grants.js'

function detail(overrides: Partial<OpenApeCliAuthorizationDetail>): OpenApeCliAuthorizationDetail {
  return {
    type: 'openape_cli',
    cli_id: 'o365',
    operation_id: 'mail.list',
    resource_chain: [{ resource: 'mail' }],
    action: 'list',
    permission: 'o365.mail[*]#list',
    display: 'List mails',
    risk: 'low',
    ...overrides,
  }
}

function segment(d: OpenApeCliAuthorizationDetail) {
  return { detail: d } as never
}

describe('compoundCoveredByDetails', () => {
  it('true when every segment detail is covered by some granted detail', () => {
    const grantedWide = detail({ resource_chain: [{ resource: 'mail' }] })
    const segNarrow = detail({ resource_chain: [{ resource: 'mail', selector: { id: 'X' } }], operation_id: 'mail.read', action: 'read', permission: 'o365.mail[id=X]#read' })
    const grantedRead = detail({ operation_id: 'mail.read', action: 'read', permission: 'o365.mail[*]#read' })
    expect(compoundCoveredByDetails(
      [grantedWide, grantedRead],
      { segments: [segment(detail({})), segment(segNarrow)] },
    )).toBe(true)
  })

  it('false as soon as ONE segment is uncovered', () => {
    const granted = [detail({})]
    const jq = detail({ cli_id: 'jq', operation_id: '_generic.exec', action: 'exec', permission: 'jq.cli[name=jq].argv[hash=h]#exec', resource_chain: [{ resource: 'cli', selector: { name: 'jq' } }, { resource: 'argv', selector: { hash: 'h' } }] })
    expect(compoundCoveredByDetails(granted, { segments: [segment(detail({})), segment(jq)] })).toBe(false)
  })

  it('false for empty granted details', () => {
    expect(compoundCoveredByDetails([], { segments: [segment(detail({}))] })).toBe(false)
  })
})
