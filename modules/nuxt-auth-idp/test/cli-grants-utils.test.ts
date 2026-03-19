import { describe, expect, it } from 'vitest'
import { formatCliResourceChain, getCliAuthorizationDetails, summarizeCliGrant } from '../src/runtime/utils/cli-grants'

function buildDetail(overrides: Record<string, unknown> = {}) {
  return {
    type: 'openape_cli' as const,
    cli_id: 'exo',
    operation_id: 'dns.show',
    resource_chain: [
      { resource: 'account', selector: { name: 'current' } },
      { resource: 'dns-domain', selector: { name: 'example.com' } },
      { resource: 'dns-record' },
    ],
    action: 'list',
    permission: 'exo.account[name=current].dns-domain[name=example.com].dns-record[*]#list',
    display: 'List DNS records in Exoscale domain "example.com"',
    risk: 'low' as const,
    ...overrides,
  }
}

describe('CLI grant helpers', () => {
  it('filters CLI authorization details from mixed arrays', () => {
    const details = getCliAuthorizationDetails([
      { type: 'openape_grant', action: 'delegate' },
      buildDetail(),
    ])

    expect(details).toHaveLength(1)
    expect(details[0]?.cli_id).toBe('exo')
  })

  it('formats resource chains for approval UI', () => {
    expect(formatCliResourceChain(buildDetail())).toBe('account[name=current] -> dns-domain[name=example.com] -> dns-record[*]')
  })

  it('summarizes single and multi-operation CLI grants', () => {
    expect(summarizeCliGrant([buildDetail()])).toBe('List DNS records in Exoscale domain "example.com"')
    expect(summarizeCliGrant([
      buildDetail(),
      buildDetail({
        operation_id: 'dns.show.record',
        display: 'Read DNS record "www"',
        permission: 'exo.account[name=current].dns-domain[name=example.com].dns-record[name=www]#read',
        action: 'read',
      }),
    ])).toBe('exo: 2 requested operations')
  })
})
