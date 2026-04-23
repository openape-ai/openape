import type { H3Event } from 'h3'
import type { OpenApeGrantRequest } from '@openape/core'

/**
 * A pre-approval hook lets the consuming app auto-approve an otherwise
 * pending grant request. Runs AFTER standing-grant evaluation, so
 * standing grants remain the more specific match.
 *
 * Return `null` to fall through to the normal manual approval flow.
 * Return `{ kind, decidedBy }` to mark the grant approved on the spot:
 *   - `kind`: audit marker written to `grants.auto_approval_kind`.
 *   - `decidedBy`: identity credited for the decision (lands in `grants.decided_by`).
 */
export interface PreApprovalResult {
  kind: string
  decidedBy: string
}

export type PreApprovalHook = (
  event: H3Event,
  request: OpenApeGrantRequest,
) => Promise<PreApprovalResult | null> | PreApprovalResult | null

const hooks: PreApprovalHook[] = []

/**
 * Register a pre-approval hook. Usually called once from a Nitro plugin.
 * Multiple hooks are supported; the first non-null match wins.
 */
export function definePreApprovalHook(hook: PreApprovalHook) {
  hooks.push(hook)
}

/**
 * Evaluate registered hooks in registration order. Returns the first
 * non-null match, or null if none match.
 */
export async function runPreApprovalHooks(
  event: H3Event,
  request: OpenApeGrantRequest,
): Promise<PreApprovalResult | null> {
  for (const hook of hooks) {
    try {
      const result = await hook(event, request)
      if (result) return result
    }
    catch (err) {
      // A broken hook shouldn't block legitimate grant flow — log + continue.
      console.error('[pre-approval-hook] failed:', err)
    }
  }
  return null
}
