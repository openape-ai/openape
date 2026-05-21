// Public types for the prompt-injection detector (#277).
//
// The detector is pure: it sees text + sender context and emits a
// score with an optional reason. It cannot execute anything. The
// caller (chat-bridge) decides what to do above the threshold —
// typically: don't forward to pi, reply with a refusal, optionally
// notify the owner.

export interface SenderContext {
  /** Email of the message author (DDISA identity). */
  email: string
  /**
   * Is this the agent's owner sending? Owner messages typically run
   *  with a higher threshold (they're allowed to override behaviour).
   */
  isOwner: boolean
}

export interface DetectionInput {
  text: string
  sender: SenderContext
}

export interface DetectionResult {
  /** 0..1 — confidence that the input is a prompt injection. */
  score: number
  /**
   * Short human-readable label of the matched pattern / model
   *  classification. Surfaces in audit logs + the refusal reply.
   */
  reason?: string
  /** Which backend produced this result. */
  backend: 'heuristic' | 'llm'
}

export interface Detector {
  classify: (input: DetectionInput) => Promise<DetectionResult>
}

export interface DetectorOptions {
  /**
   * Decision threshold. A `score >= threshold` is treated as
   * injection. The caller is in charge of mapping that decision to
   * a refusal / owner-notification — the detector itself only
   * classifies, never acts.
   *
   * Default: 0.7 — tuned to bias toward false negatives so the
   * owner doesn't get blocked sending legitimate instructions. The
   * bridge can override per-deployment.
   */
  threshold?: number
  /**
   * Owners are presumed cooperative — set a HIGHER threshold for
   * messages from the agent owner so legitimate "run shell, do
   * X" instructions from the actual owner aren't refused.
   *
   * Default: 0.95.
   */
  ownerThreshold?: number
}

export const DEFAULT_THRESHOLD = 0.7
export const DEFAULT_OWNER_THRESHOLD = 0.95
