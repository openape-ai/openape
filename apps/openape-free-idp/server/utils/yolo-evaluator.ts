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
  command: string[] | undefined
  resolvedRisk: RiskLevel | null
  now?: number
}

export function evaluateYoloPolicy(ctx: YoloDecisionContext): YoloDecision | null {
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
