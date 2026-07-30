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

  // DENY WINS, IN BOTH MODES. A deny hit is a veto — no allow-pattern and no
  // risk threshold can overrule it. Before 2026-07-30 denyPatterns were
  // stored-but-inert in allow-list mode, which made the mode decide whether a
  // safety rule applied at all: a role handing out a whole CLI (`o365-cli *`)
  // auto-approved `mail send`, even though `*mail send*` sat right there in
  // the deny list. One asymmetry nobody could see without reading this file.
  const denyPatterns = p.denyPatterns || []
  const denyHit = (text: string) => denyPatterns.some(pattern => matchesGlob(text, pattern))
  if (denyPatterns.length > 0) {
    // Full line, every segment, and the pre-unwrap outer form — a deny rule
    // must not be dodgeable by chaining or by the bash -c wrapper.
    if (denyHit(target)) return null
    if (segments.some(denyHit)) return null
    if (ctx.outerTarget && denyHit(ctx.outerTarget)) return null
  }

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
  // The deny-pattern veto already ran above, for both modes.
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

/**
 * Why did this request NOT get auto-approved by the YOLO policy?
 *
 * Diagnosis only — it never decides anything. It deliberately re-uses the
 * exact predicates `evaluateYoloPolicy` uses (`denyHit`, `segmentAllowed`,
 * the same segmentation) so the explanation cannot drift away from the
 * decision. If the two ever disagree, that shows up as
 * `'would-have-approved'`, which is a bug signal, not a normal state.
 *
 * Motivation: on 2026-07-30 answering "why is this pending?" for a single
 * request took a hand-written script against the live policy. The IdP knows
 * the answer exactly — it should just say it.
 */
export type YoloMissReason =
  | 'no-policy'
  | 'policy-expired'
  | 'no-target'
  | 'denied-by-pattern'
  | 'segments-not-allowed'
  | 'risk-above-threshold'
  | 'would-have-approved'

export interface YoloMissExplanation {
  reason: YoloMissReason
  /** Shell segments the line was judged in (the unit patterns match against). */
  segments?: string[]
  /** Segments covered by an allow-pattern. */
  allowedSegments?: string[]
  /** Segments no allow-pattern covers — the actionable list. */
  unmatchedSegments?: string[]
  /** Segments carrying command substitution: these need a pattern spelling it out. */
  substitutionSegments?: string[]
  /** The deny pattern that vetoed, plus the segment that tripped it. */
  deniedBy?: string
  deniedSegment?: string
  expiredAt?: number
  resolvedRisk?: RiskLevel | null
  riskThreshold?: RiskLevel | null
  mode?: YoloPolicy['mode']
}

export function explainYoloMiss(ctx: YoloDecisionContext): YoloMissExplanation {
  const now = ctx.now ?? Math.floor(Date.now() / 1000)
  const p = ctx.policy
  if (!p) return { reason: 'no-policy' }
  if (p.expiresAt != null && p.expiresAt <= now)
    return { reason: 'policy-expired', expiredAt: p.expiresAt, mode: p.mode }

  const target = ctx.target && ctx.target.length ? ctx.target : null
  if (!target) return { reason: 'no-target', mode: p.mode }

  const segments = ctx.targetKind === 'host' ? [target] : splitCommandSegments(target)
  const base = { segments, mode: p.mode, resolvedRisk: ctx.resolvedRisk, riskThreshold: p.denyRiskThreshold }

  // Same veto as the decision — but reported segment-first. The decision
  // checks the whole line first (order is irrelevant there, both block);
  // for an explanation the precise segment is the useful answer.
  const denyPatterns = p.denyPatterns || []
  for (const pattern of denyPatterns) {
    const seg = segments.find(sgm => matchesGlob(sgm, pattern))
    if (seg)
      return { ...base, reason: 'denied-by-pattern', deniedBy: pattern, deniedSegment: seg }
    if (matchesGlob(target, pattern))
      return { ...base, reason: 'denied-by-pattern', deniedBy: pattern, deniedSegment: target }
    if (ctx.outerTarget && matchesGlob(ctx.outerTarget, pattern))
      return { ...base, reason: 'denied-by-pattern', deniedBy: pattern, deniedSegment: ctx.outerTarget }
  }

  if (p.mode === 'allow-list') {
    const allowPatterns = p.allowPatterns || []
    const segmentAllowed = (seg: string) => {
      const needsExplicitOptIn = containsCommandSubstitution(seg)
      return allowPatterns.some(pattern => matchesGlob(seg, pattern)
        && (!needsExplicitOptIn || containsCommandSubstitution(pattern)))
    }
    const allowed = segments.filter(segmentAllowed)
    const unmatched = segments.filter(seg => !segmentAllowed(seg))
    // Mirror the DECISION's order: patterns first, then the risk threshold.
    // Reporting 'segments-not-allowed' before checking risk would claim a
    // block the evaluator does not perform — caught by the equivalence
    // matrix below, which is exactly why that test exists.
    const riskApproves = ctx.resolvedRisk != null && p.denyRiskThreshold != null
      && RISK_ORDER[ctx.resolvedRisk] <= RISK_ORDER[p.denyRiskThreshold]
    if (unmatched.length > 0 && !riskApproves) {
      return {
        ...base,
        reason: 'segments-not-allowed',
        allowedSegments: allowed,
        unmatchedSegments: unmatched,
        substitutionSegments: unmatched.filter(containsCommandSubstitution),
      }
    }
    // Allowed by patterns or by risk, and no deny hit → the decision approves.
    return { ...base, reason: 'would-have-approved' }
  }

  // deny-list: the only remaining blockers are the risk threshold and the
  // fail-closed substitution rule.
  if (ctx.resolvedRisk && p.denyRiskThreshold
    && RISK_ORDER[ctx.resolvedRisk] > RISK_ORDER[p.denyRiskThreshold]) {
    return { ...base, reason: 'risk-above-threshold' }
  }
  const substitution = segments.filter(containsCommandSubstitution)
  if (substitution.length > 0 && !denyPatterns.some(containsCommandSubstitution))
    return { ...base, reason: 'segments-not-allowed', unmatchedSegments: substitution, substitutionSegments: substitution }
  return { ...base, reason: 'would-have-approved' }
}
