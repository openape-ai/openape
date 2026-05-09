/**
 * Audience-bucket registry. Groups grant-audiences into the three policy-
 * enforcement layers the IdP UI surfaces:
 *
 *  - **commands**: per-bash-line / per-tool-invocation gates. The grant
 *    decides "may this agent execute this command?" Audited at command-level.
 *    Audiences: `ape-shell` (REPL line dispatch + `apes run --shell`),
 *    `claude-code` (the Claude PreToolUse Bash gate), `shapes` (typed CLI
 *    adapter mode), and any adapter-defined audience falls here by default.
 *
 *  - **web**: per-host network-egress gates. The grant decides "may this
 *    agent reach this host?" Audited at HTTPS-CONNECT / HTTP-forward level.
 *    Audiences: `ape-proxy`.
 *
 *  - **root**: privilege-elevated execution. The grant decides "may this
 *    agent run a command as root?" Audited per-elevation.
 *    Audiences: `escapes`.
 *
 *  - **other**: anything not yet categorized. New audiences from plugins or
 *    future products land here until added to KNOWN_BUCKETS.
 *
 * The bucket is purely a UI/UX grouping — it never affects grant evaluation.
 * Per-audience YOLO policies and standing grants are stored with the literal
 * `audience` string; the bucket is computed at read-time for display.
 */

export type AudienceBucket = 'commands' | 'web' | 'root' | 'other'

/**
 * Hardcoded mapping of well-known audience strings to buckets. Update when
 * a new bundled audience ships. Plugin-defined audiences fall to 'other'
 * until explicitly registered here.
 */
export const KNOWN_BUCKETS: Record<string, AudienceBucket> = {
  // Commands layer
  'ape-shell': 'commands',
  'claude-code': 'commands',
  'shapes': 'commands',
  // The local Nest control-plane daemon (`apes nest spawn|destroy|list`).
  // Commands layer because the Nest's API surface is "may this caller
  // tell my Mac to spawn/destroy a local agent?" — gated per-call.
  'nest': 'commands',
  // Web layer
  'ape-proxy': 'web',
  // Root-Commands layer
  'escapes': 'root',
}

/**
 * The wildcard audience string used by yolo_policies and similar tables to
 * mean "applies to every audience that doesn't have its own row". Exported
 * as a constant so callers don't sprinkle the literal '*' across the
 * codebase.
 */
export const AUDIENCE_WILDCARD = '*'

/** Bucket lookup. Returns 'other' for unknown audiences. */
export function bucketFor(audience: string): AudienceBucket {
  return KNOWN_BUCKETS[audience] ?? 'other'
}

/** Reverse lookup: every audience known to belong to a given bucket. */
export function audiencesInBucket(bucket: AudienceBucket): string[] {
  return Object.entries(KNOWN_BUCKETS)
    .filter(([, b]) => b === bucket)
    .map(([a]) => a)
}

/**
 * The buckets surfaced in the UI in canonical display order. 'other' is
 * rendered last and only when there are audiences that don't map to a
 * known bucket.
 */
export const DISPLAY_BUCKETS: readonly AudienceBucket[] = ['commands', 'web', 'root', 'other']
