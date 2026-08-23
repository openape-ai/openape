import type { OpenApeCliAuthorizationDetail } from '@openape/core'

/**
 * Rule derivation for the approval surfaces: turn one concrete request into
 * a proposal that covers future requests like it. Shaped CLI requests become
 * standing-grant templates; free-form command lines become allow-pattern
 * suggestions. Shared by /grants (card quick action) and /grant-approval.
 */

/**
 * Suggest an allow-pattern generalizing a command line: keep the leading
 * bare-word tokens (binary + subcommands), wildcard the arguments —
 * `o365-cli mail archive-from a@b.c` → `o365-cli mail archive-from *`.
 *
 * Returns null when no safe generalization exists (only the binary would
 * remain, e.g. `ls -la` or `bash deploy.sh`) — a `<binary> *` pattern is
 * broader than an approver scanning the preview would expect.
 */
export function suggestAllowPattern(command: string): string | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return null
  const keep: string[] = [tokens[0]!]
  for (const token of tokens.slice(1)) {
    if (keep.length >= 4) break
    if (!/^[a-z][\w-]*$/i.test(token)) break
    keep.push(token)
  }
  if (keep.length < 2) return null
  return `${keep.join(' ')} *`
}

export interface RuleProposal {
  cliId: string
  template: Array<{ resource: string, selector?: Record<string, string> }>
  maxRisk: string
  samples: string[]
}

const RULE_RISK_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 }

/**
 * Derive one standing-grant proposal per shaped CLI in the request (plan
 * 2026-07-29-compound-shapes-grants M3): the first resource link keeps its
 * selector (the account/scope anchor), the rest wildcard; max_risk caps at
 * the highest incoming risk so the adapter's risk model does the verb-gating.
 * Generic details are excluded — a rule for one exact argv is pointless.
 */
export function buildRuleProposals(details: OpenApeCliAuthorizationDetail[]): RuleProposal[] {
  const byCli = new Map<string, RuleProposal>()
  for (const detail of details) {
    if (!detail || detail.operation_id === '_generic.exec') continue
    const existing = byCli.get(detail.cli_id)
    if (!existing) {
      byCli.set(detail.cli_id, {
        cliId: detail.cli_id,
        template: detail.resource_chain.map((link, i) => i === 0 ? link : { resource: link.resource }),
        maxRisk: detail.risk,
        samples: [detail.display],
      })
    }
    else {
      if ((RULE_RISK_ORDER[detail.risk] ?? 0) > (RULE_RISK_ORDER[existing.maxRisk] ?? 0)) existing.maxRisk = detail.risk
      existing.samples.push(detail.display)
    }
  }
  return [...byCli.values()]
}

function formatTemplateChain(template: RuleProposal['template']): string {
  return template
    .map(link => link.selector
      ? `${link.resource}[${Object.entries(link.selector).map(([k, v]) => `${k}=${v}`).join(',')}]`
      : `${link.resource}[*]`)
    .join('.')
}

export function ruleTemplatePreview(proposal: RuleProposal): string {
  return `${proposal.cliId}.${formatTemplateChain(proposal.template)} — risk ≤ ${proposal.maxRisk}`
}

/**
 * The same sentence again, this time read back off a stored standing grant —
 * so the active-permissions list says what the rule lets through, in the
 * wording the approver confirmed when creating it (#1308).
 *
 * Returns null for anything that is not a standing grant, which is what the
 * card falls back to today.
 */
export function standingRulePreview(request: {
  cli_id?: string
  audience?: string
  max_risk?: string
  resource_chain_template?: RuleProposal['template']
} | undefined): string | null {
  const template = request?.resource_chain_template
  if (!Array.isArray(template) || !template.length) return null
  const head = request?.cli_id ?? request?.audience ?? 'cli'
  // No cap stored means the rule caps nothing; saying `risk ≤ critical`
  // would read like a limit where there is none.
  const risk = request?.max_risk ? ` — risk ≤ ${request.max_risk}` : ''
  return `${head}.${formatTemplateChain(template)}${risk}`
}
