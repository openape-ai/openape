import type { OpenApeGrantRequest } from '@openape/core'
import type { YoloPolicy, RiskLevel } from './yolo-policy-store'

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

export interface YoloEvaluation {
  kind: 'yolo'
  decidedBy: string
}

export interface YoloDecisionContext {
  policy: YoloPolicy | null
  command: string[] | undefined
  resolvedRisk: RiskLevel | null
  now?: number
}

/**
 * Decide whether a grant request should be auto-approved by the agent's
 * YOLO policy. Returns the approval marker on match, null on miss (caller
 * falls back to the normal manual approval flow).
 *
 * Contract:
 *  - No policy, expired policy, or no command → miss.
 *  - Resolved-risk meets or exceeds policy.denyRiskThreshold → miss.
 *  - Command matches any deny-pattern (glob) → miss.
 *  - Otherwise → match with decidedBy = policy.enabledBy.
 */
export function evaluateYoloPolicy(ctx: YoloDecisionContext): YoloEvaluation | null {
  const now = ctx.now ?? Math.floor(Date.now() / 1000)
  const p = ctx.policy
  if (!p) return null
  if (p.expiresAt != null && p.expiresAt <= now) return null

  const cmd = ctx.command && ctx.command.length ? ctx.command.join(' ') : null
  if (!cmd) return null

  if (ctx.resolvedRisk && p.denyRiskThreshold) {
    if (RISK_ORDER[ctx.resolvedRisk] >= RISK_ORDER[p.denyRiskThreshold]) return null
  }

  for (const pattern of p.denyPatterns || []) {
    if (matchesGlob(cmd, pattern)) return null
  }

  return { kind: 'yolo', decidedBy: p.enabledBy }
}

/**
 * Minimal glob matcher — `*` matches any run of characters (greedy),
 * `?` matches exactly one. Case-sensitive; no character classes. Kept
 * local to avoid pulling a dependency for a handful of patterns.
 */
export function matchesGlob(input: string, pattern: string): boolean {
  const escaped = pattern.replace(/[\\^$.+(){}[\]|]/g, ch => `\\${ch}`)
  const regexSrc = `^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`
  try {
    return new RegExp(regexSrc).test(input)
  }
  catch {
    return false
  }
}

export function commandFromRequest(body: OpenApeGrantRequest): string[] | undefined {
  if (body.command?.length) return body.command
  const argv = body.execution_context?.argv
  if (argv?.length) return [...argv]
  return undefined
}
