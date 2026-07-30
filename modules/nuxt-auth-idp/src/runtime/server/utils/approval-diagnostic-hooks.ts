import type { H3Event } from 'h3'
import type { OpenApeGrantRequest } from '@openape/core'

/**
 * The mirror image of `definePreApprovalHook`: a pre-approval hook DECIDES,
 * a diagnostic hook EXPLAINS. Same registration shape on purpose, so an app
 * that owns an auto-approval mechanism (free-idp's YOLO policy) also owns
 * the answer to "why didn't it fire?".
 *
 * Diagnostics never influence a decision. They run only for a grant that is
 * already pending and are read-only — a broken hook costs an explanation,
 * never a grant.
 */
export interface ApprovalDiagnostic {
  /** Which mechanism this explains, e.g. 'yolo'. */
  source: string
  /** Machine-readable reason code, e.g. 'segments-not-allowed'. */
  reason: string
  /** One sentence for a human, in the UI's voice. */
  summary: string
  /** Structured extras the UI may render (segments, patterns, timestamps). */
  detail?: Record<string, unknown>
}

export type ApprovalDiagnosticHook = (
  event: H3Event,
  request: OpenApeGrantRequest,
) => Promise<ApprovalDiagnostic | null> | ApprovalDiagnostic | null

const hooks: ApprovalDiagnosticHook[] = []

/** Register a diagnostic hook. Usually called once from a Nitro plugin. */
export function defineApprovalDiagnosticHook(hook: ApprovalDiagnosticHook) {
  hooks.push(hook)
}

/**
 * Collect every hook's explanation. Unlike pre-approval hooks this does NOT
 * stop at the first result — a request can miss several mechanisms at once,
 * and the owner wants to see all of them.
 */
export async function runApprovalDiagnosticHooks(
  event: H3Event,
  request: OpenApeGrantRequest,
): Promise<ApprovalDiagnostic[]> {
  const out: ApprovalDiagnostic[] = []
  for (const hook of hooks) {
    try {
      const result = await hook(event, request)
      if (result) out.push(result)
    }
    catch (err) {
      // An explanation is a nice-to-have; never let it break the page.
      console.error('[approval-diagnostic-hook] failed:', err)
    }
  }
  return out
}
