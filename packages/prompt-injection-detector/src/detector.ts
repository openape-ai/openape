// Caller-facing helper. Wraps a backend `Detector` with the
// threshold-decision the bridge actually needs: "should I let this
// message through?". Pure — no I/O, no side-effects.

import type { Detector, DetectionInput, DetectionResult, DetectorOptions } from './types.js'
import { DEFAULT_OWNER_THRESHOLD, DEFAULT_THRESHOLD } from './types.js'

export interface DecisionResult extends DetectionResult {
  /**
   * True when `score >= threshold` for this sender. The bridge
   *  should refuse to forward the message when this is true.
   */
  blocked: boolean
  /**
   * The threshold this decision was measured against (varies by
   *  sender — owner gets a higher bar).
   */
  threshold: number
}

export async function decide(
  detector: Detector,
  input: DetectionInput,
  opts: DetectorOptions = {},
): Promise<DecisionResult> {
  const threshold = input.sender.isOwner
    ? opts.ownerThreshold ?? DEFAULT_OWNER_THRESHOLD
    : opts.threshold ?? DEFAULT_THRESHOLD
  const result = await detector.classify(input)
  return {
    ...result,
    threshold,
    blocked: result.score >= threshold,
  }
}
