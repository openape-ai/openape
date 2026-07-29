// YOLO evaluator + minimal glob matcher. Pure decision logic; the only side
// effect is a once-per-policy operator warning about ineffective policies.
import type { OpenApeGrantRequest } from '@openape/core'
import { containsCommandSubstitution, splitCommandSegments } from '@openape/core'
import type { RiskLevel, YoloPolicy } from './yolo-policy-store'

// Moved to @openape/core (shared with the shapes track); re-exported so the
// app's existing imports and tests keep one canonical entry point here.
export { containsCommandSubstitution, splitCommandSegments }

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
   * The pre-unwrap joined command line when `target` was extracted from a
   * `bash -c` wrapper. Deny patterns are ALSO checked against this so
   * policies written against the outer form (`bash -c *rm*`) keep blocking
   * after the unwrap — disarming an existing deny rule would fail open.
   * Allow patterns never consult it (fail-closed direction).
   */
  outerTarget?: string
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
    //    A pattern hit does not vouch for nested commands: a segment with
    //    command/process substitution is only allowed by a pattern spelling
    //    the construct out itself — that is the owner's explicit opt-in.
    const allowPatterns = p.allowPatterns || []
    const segmentAllowed = (seg: string) => {
      const needsExplicitOptIn = containsCommandSubstitution(seg)
      return allowPatterns.some(pattern => matchesGlob(seg, pattern)
        && (!needsExplicitOptIn || containsCommandSubstitution(pattern)))
    }
    if (allowPatterns.length > 0 && segments.every(segmentAllowed)) {
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
  const denyPatterns = p.denyPatterns || []
  for (const pattern of denyPatterns) {
    if (matchesGlob(target, pattern)) return null
    if (segments.some(seg => matchesGlob(seg, pattern))) return null
    // Outer-form compatibility: deny rules written before the bash -c unwrap
    // matched the joined wrapper line. Keep honoring them.
    if (ctx.outerTarget && matchesGlob(ctx.outerTarget, pattern)) return null
  }
  // Harder than the usual default-allow semantics on purpose: a blocklist
  // cannot see into a substitution — `echo $(rm -rf ~)` matches no `*rm*`
  // pattern even though the shell runs the nested command. Fail closed to
  // the human, unless a deny pattern spells the construct out itself (then
  // the owner governs substitutions by pattern and normal deny logic rules).
  const ownerGovernsSubstitution = denyPatterns.some(pattern => containsCommandSubstitution(pattern))
  if (!ownerGovernsSubstitution && segments.some(seg => containsCommandSubstitution(seg))) {
    return null
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
  if (cmd && cmd.length > 0) {
    // `bash -c <line>` unwrap: patterns describe the command the agent runs,
    // not the shell that carries it — without this, operators need every
    // pattern in a bash-c double form. Only the exact 3-element shape is
    // unwrapped: extra argv after the -c string become $0/$1 positional
    // params and flags before -c change semantics, both fall back to the
    // joined form (fail closed). One level only — a nested `bash -c` stays
    // wrapped and needs its own explicit pattern. Returning the inner string
    // VERBATIM also fixes a subtle corruption: joining destroyed the quoting
    // before the quote-aware segment splitter ran.
    if (cmd.length === 3 && (cmd[0] === 'bash' || cmd[0] === 'sh') && cmd[1] === '-c')
      return cmd[2]
    return cmd.join(' ')
  }
  if (body.target_host) return body.target_host
  return undefined
}
