// YOLO evaluator + minimal glob matcher. Pure functions; no side effects.
import type { OpenApeGrantRequest } from '@openape/core'
import type { RiskLevel, YoloPolicy } from './yolo-policy-store'

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

export interface YoloDecision {
  kind: 'yolo'
  decidedBy: string
}

export interface YoloDecisionContext {
  policy: YoloPolicy | null
  /**
   * The string the active pattern list is matched against. Two shapes:
   *
   * - For Commands / Root grants this is the joined command line (e.g.
   *   `"git push origin main"`). Operators write bash-style globs like
   *   `"rm -rf *"` or `"sudo *"`.
   *
   * - For Web grants this is the `target_host[:port]` (e.g.
   *   `"api.openai.com:443"`). Operators write host globs like
   *   `"*.openai.com"` or `"169.254.169.254"`.
   *
   * The evaluator doesn't care which of the two shapes it gets — both go
   * through the same glob matcher. The hook is responsible for picking the
   * right field from the grant request via `targetFromRequest`.
   */
  target: string | undefined
  resolvedRisk: RiskLevel | null
  now?: number
}

export function evaluateYoloPolicy(ctx: YoloDecisionContext): YoloDecision | null {
  const now = ctx.now ?? Math.floor(Date.now() / 1000)
  const p = ctx.policy
  if (!p) return null
  if (p.expiresAt != null && p.expiresAt <= now) return null

  const target = ctx.target && ctx.target.length ? ctx.target : null
  if (!target) return null

  // Risk-threshold semantic is SYMMETRIC across modes:
  //   "alles bis zu diesem Level wird auto-approved, alles darüber wartet"
  // - deny-list (default allow): risk > threshold → don't approve.
  // - allow-list (default deny): risk ≤ threshold → approve.
  // The pattern list adds further nuance:
  // - deny-list: explicit deny-pattern → don't approve (further restrict).
  // - allow-list: explicit allow-pattern → approve (further open).
  if (p.mode === 'allow-list') {
    // 1. Explicit allow-pattern match → approve.
    for (const pattern of p.allowPatterns || []) {
      if (matchesGlob(target, pattern)) return { kind: 'yolo', decidedBy: p.enabledBy }
    }
    // 2. Risk ≤ threshold → approve.
    if (ctx.resolvedRisk && p.denyRiskThreshold) {
      if (RISK_ORDER[ctx.resolvedRisk] <= RISK_ORDER[p.denyRiskThreshold]) {
        return { kind: 'yolo', decidedBy: p.enabledBy }
      }
    }
    // 3. Neither path matched → human approval.
    return null
  }

  // Deny-list mode (default allow + restrictions).
  if (ctx.resolvedRisk && p.denyRiskThreshold) {
    // Risk > threshold → don't approve.
    if (RISK_ORDER[ctx.resolvedRisk] > RISK_ORDER[p.denyRiskThreshold]) return null
  }
  for (const pattern of p.denyPatterns || []) {
    if (matchesGlob(target, pattern)) return null
  }
  return { kind: 'yolo', decidedBy: p.enabledBy }
}

/**
 * Minimal glob matcher — `*` matches any run of characters (greedy),
 * `?` matches exactly one. Case-sensitive; no character classes.
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

/**
 * Extract the deny-pattern match-target from a grant request:
 *
 *   - Commands / Root grants (audience: ape-shell, claude-code, shapes,
 *     escapes, …): joined `command` array.
 *   - Web grants (audience: ape-proxy): the `target_host`. The proxy passes
 *     it as `target_host: "api.openai.com"` (no port suffix today; the
 *     evaluator and operator-written patterns must agree on that).
 *
 * The hook calls this at request time and feeds the result into
 * `evaluateYoloPolicy` as `ctx.target`. Returns undefined when neither
 * shape is present — evaluator interprets that as "no match data → no
 * YOLO" and returns null (= human approval needed).
 */
export function targetFromRequest(body: OpenApeGrantRequest): string | undefined {
  const cmd = commandFromRequest(body)
  if (cmd && cmd.length > 0) return cmd.join(' ')
  if (body.target_host) return body.target_host
  return undefined
}
