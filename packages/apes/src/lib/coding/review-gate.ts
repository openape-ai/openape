// Reviewer-agent gate (M7). Sits between "verify passed" and "arm the
// merge". For code-class changes a second agent reviews the diff and
// must approve; risk-class changes never auto-merge (human only);
// chore-class skips review.
//
// The actual reviewer-agent dispatch is injected as a `ReviewerFn` so
// this module stays pure + testable and the heavy second-agent spawn
// lives in the integration layer.

import type { MergeDecision } from './merge-policy'

export interface ReviewVerdict {
  approved: boolean
  reason?: string
}

export interface ReviewRequest {
  prRef: string | number
  diff: string
  classification: MergeDecision['classification']
}

export type ReviewerFn = (req: ReviewRequest) => Promise<ReviewVerdict>

export interface GateOutcome {
  // May the agent now arm the (auto-)merge?
  armMerge: boolean
  // Did we stop and hand off to a human?
  awaitingHuman: boolean
  reason: string
}

// Decide + (when needed) run the reviewer. Branch protection still
// enforces CI-green server-side regardless of this outcome.
export async function gateMerge(
  decision: MergeDecision,
  req: Omit<ReviewRequest, 'classification'>,
  reviewer: ReviewerFn,
): Promise<GateOutcome> {
  if (decision.needsHuman) {
    return { armMerge: false, awaitingHuman: true, reason: 'risk-path change — handed off to human reviewer' }
  }
  if (!decision.needsReview) {
    // chore/docs — straight to arm-merge (CI still gates server-side).
    return { armMerge: true, awaitingHuman: false, reason: 'chore change — no reviewer gate' }
  }
  // code — require reviewer-agent approval.
  const verdict = await reviewer({ ...req, classification: decision.classification })
  if (verdict.approved) {
    return { armMerge: true, awaitingHuman: false, reason: `reviewer approved${verdict.reason ? `: ${verdict.reason}` : ''}` }
  }
  return { armMerge: false, awaitingHuman: false, reason: `reviewer blocked${verdict.reason ? `: ${verdict.reason}` : ''}` }
}
