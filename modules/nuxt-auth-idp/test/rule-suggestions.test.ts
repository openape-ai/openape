import { describe, expect, it } from 'vitest'
import { ruleTemplatePreview, standingRulePreview, suggestAllowPattern } from '../src/runtime/utils/rule-suggestions'

it('does not mistake spaces inside an executable name for subcommands', () => {
  expect(suggestAllowPattern(['OpenApe Pods', '/Applications/OpenApe Pods.app/runtime/script-entry.mjs', '--input-channel'])).toBeNull()
  expect(suggestAllowPattern(['tool', 'mail', 'list', '--top', '5'])).toBe('tool mail list *')
  expect(suggestAllowPattern('tool mail list --top 5')).toBe('tool mail list *')
})

describe('standingRulePreview', () => {
  const rule = {
    cli_id: 'exo',
    audience: 'shapes',
    max_risk: 'medium',
    resource_chain_template: [
      { resource: 'account', selector: { name: 'current' } },
      { resource: 'dns-domain' },
      { resource: 'dns-record' },
    ],
  }

  it('reads the rule back in the wording it was approved in', () => {
    expect(standingRulePreview(rule)).toBe(
      'exo.account[name=current].dns-domain[*].dns-record[*] — risk ≤ medium',
    )
    expect(standingRulePreview(rule)).toBe(ruleTemplatePreview({
      cliId: 'exo',
      template: rule.resource_chain_template,
      maxRisk: 'medium',
      samples: [],
    }))
  })

  it('claims no cap when the rule stores none', () => {
    expect(standingRulePreview({ ...rule, max_risk: undefined })).toBe(
      'exo.account[name=current].dns-domain[*].dns-record[*]',
    )
  })

  it('falls back to the audience when no cli_id was stored', () => {
    expect(standingRulePreview({ ...rule, cli_id: undefined })).toMatch(/^shapes\./)
  })

  it('returns null for grants that carry no rule', () => {
    expect(standingRulePreview({ cli_id: 'exo' })).toBeNull()
    expect(standingRulePreview({ ...rule, resource_chain_template: [] })).toBeNull()
    expect(standingRulePreview(undefined)).toBeNull()
  })
})
