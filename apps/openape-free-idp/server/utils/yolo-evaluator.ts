// YOLO evaluator + minimal glob matcher. Pure decision logic; the only side
// effect is a once-per-policy operator warning about ineffective policies.
import type { OpenApeGrantRequest } from '@openape/core'
import type { RiskLevel, YoloPolicy } from './yolo-policy-store'

// Stored deny-list policies without any rules predate the fail-closed check
// in the PUT endpoint. They are neutralized below, but the operator should
// notice — warn once per policy per process, not per request.
const warnedIneffectivePolicies = new Set<string>()

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
  /**
   * How to interpret `target` for pattern matching (#1079): `'command'`
   * targets are split into shell segments and evaluated per segment,
   * `'host'` targets have no shell semantics and are matched as-is.
   * Defaults to `'command'` — segmentation is the fail-safe direction.
   */
  targetKind?: 'command' | 'host'
  resolvedRisk: RiskLevel | null
  now?: number
}

/**
 * Split a command line at the shell control operators (`&&`, `||`, `;`, `|`,
 * `&`, newlines) into trimmed, non-empty segments. Operators inside single
 * or double quotes are literal text, not separators; a backslash escapes the
 * next character (except inside single quotes) so `\"` never toggles quote
 * state. Why: allow/deny patterns describe COMMANDS, not line prefixes —
 * every chained command must be judged on its own (#1079).
 */
export function splitCommandSegments(target: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '\'' | '"' | null = null
  let escaped = false
  for (const ch of target) {
    if (escaped) {
      current += ch
      escaped = false
      continue
    }
    if (ch === '\\' && quote !== '\'') {
      current += ch
      escaped = true
      continue
    }
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '\'' || ch === '"') {
      current += ch
      quote = ch
      continue
    }
    if (ch === '&' || ch === '|' || ch === ';' || ch === '\n' || ch === '\r') {
      segments.push(current)
      current = ''
      continue
    }
    current += ch
  }
  segments.push(current)
  return segments.map(s => s.trim()).filter(s => s.length > 0)
}

export function evaluateYoloPolicy(ctx: YoloDecisionContext): YoloDecision | null {
  const now = ctx.now ?? Math.floor(Date.now() / 1000)
  const p = ctx.policy
  if (!p) return null
  if (p.expiresAt != null && p.expiresAt <= now) return null

  const target = ctx.target && ctx.target.length ? ctx.target : null
  if (!target) return null

  // Patterns allow commands, not prefixes (#1079): command lines are judged
  // per shell segment so `allowed-cmd && anything` can't ride along. Hosts
  // carry no shell semantics and stay a single segment.
  const segments = ctx.targetKind === 'host' ? [target] : splitCommandSegments(target)
  // A line consisting only of operators has nothing to judge → human decides.
  if (segments.length === 0) return null

  // Risk-threshold semantic is SYMMETRIC across modes:
  //   "alles bis zu diesem Level wird auto-approved, alles darüber wartet"
  // - deny-list (default allow): risk > threshold → don't approve.
  // - allow-list (default deny): risk ≤ threshold → approve.
  // The pattern list adds further nuance:
  // - deny-list: explicit deny-pattern → don't approve (further restrict).
  // - allow-list: explicit allow-pattern → approve (further open).
  if (p.mode === 'allow-list') {
    // 1. EVERY segment matches at least one allow-pattern → approve. One
    //    unmatched segment means an unvetted command → risk check / human.
    const allowPatterns = p.allowPatterns || []
    if (allowPatterns.length > 0
      && segments.every(seg => allowPatterns.some(pattern => matchesGlob(seg, pattern)))) {
      return { kind: 'yolo', decidedBy: p.enabledBy }
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
  // Fail closed (#1037): without at least one denyPattern or a risk threshold
  // there is no restriction at all — "default allow" would auto-approve every
  // request and silently bypass human approval. Auto-approval must be an
  // explicit opt-in (DDISA grants.md §3.1), so a rule-less deny-list is a
  // no-op policy → normal human-approval flow.
  const hasDenyRules = (p.denyPatterns?.length ?? 0) > 0 || p.denyRiskThreshold != null
  if (!hasDenyRules) {
    const key = `${p.agentEmail}|${p.audience}`
    if (!warnedIneffectivePolicies.has(key)) {
      warnedIneffectivePolicies.add(key)
      console.warn(
        `[yolo] Ignoring ineffective deny-list YOLO policy for ${p.agentEmail} (audience: ${p.audience}): `
        + 'no denyPatterns and no denyRiskThreshold. Requests fall back to human approval — '
        + 'delete the policy or add restrictions.',
      )
    }
    return null
  }
  if (ctx.resolvedRisk && p.denyRiskThreshold) {
    // Risk > threshold → don't approve.
    if (RISK_ORDER[ctx.resolvedRisk] > RISK_ORDER[p.denyRiskThreshold]) return null
  }
  // A deny hit in ANY segment blocks — prefixing a harmless command must not
  // hide it. The full line is still checked too so cross-segment patterns
  // operators wrote against the old joined-line behavior keep blocking.
  for (const pattern of p.denyPatterns || []) {
    if (matchesGlob(target, pattern)) return null
    if (segments.some(seg => matchesGlob(seg, pattern))) return null
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
