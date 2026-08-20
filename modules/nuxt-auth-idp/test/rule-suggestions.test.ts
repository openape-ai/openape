import { describe, expect, it } from 'vitest'
import { buildRuleProposals, ruleTemplatePreview, suggestAllowPattern } from '../src/runtime/utils/rule-suggestions'

describe('suggestAllowPattern', () => {
  it('keeps binary + subcommands and wildcards the arguments', () => {
    expect(suggestAllowPattern('o365-cli mail archive-from Andrea.Antalfi@llv.li --account x'))
      .toBe('o365-cli mail archive-from *')
    expect(suggestAllowPattern('o365-cli mail list --top 5')).toBe('o365-cli mail list *')
    expect(suggestAllowPattern('ape-tasks new --title "x"')).toBe('ape-tasks new *')
  })

  it('caps the kept prefix at four tokens', () => {
    expect(suggestAllowPattern('a b c d e f')).toBe('a b c d *')
  })

  it('refuses to generalize when only the binary would remain', () => {
    // `<binary> *` is broader than the preview suggests — exact-only instead.
    expect(suggestAllowPattern('ls -la')).toBeNull()
    expect(suggestAllowPattern('bash skills/troop-operator/troop.sh resolve')).toBeNull()
    expect(suggestAllowPattern('ls')).toBeNull()
    expect(suggestAllowPattern('')).toBeNull()
  })
})

describe('buildRuleProposals', () => {
  const detail = {
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
    display: 'List DNS records',
    risk: 'low' as const,
  }

  it('keeps the first selector, wildcards the rest, and previews the chain', () => {
    const proposals = buildRuleProposals([detail])
    expect(proposals).toHaveLength(1)
    expect(proposals[0]!.template).toEqual([
      { resource: 'account', selector: { name: 'current' } },
      { resource: 'dns-domain' },
      { resource: 'dns-record' },
    ])
    expect(ruleTemplatePreview(proposals[0]!)).toBe('exo.account[name=current].dns-domain[*].dns-record[*] — risk ≤ low')
  })

  it('merges details per CLI, escalating to the highest risk', () => {
    const higher = { ...detail, operation_id: 'dns.delete', action: 'delete', risk: 'high' as const, display: 'Delete' }
    const proposals = buildRuleProposals([detail, higher])
    expect(proposals).toHaveLength(1)
    expect(proposals[0]!.maxRisk).toBe('high')
    expect(proposals[0]!.samples).toHaveLength(2)
  })

  it('skips generic (unshaped) details entirely', () => {
    expect(buildRuleProposals([{ ...detail, operation_id: '_generic.exec' }])).toHaveLength(0)
  })
})
