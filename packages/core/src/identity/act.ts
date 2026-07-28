import type { ActorType } from '../types/index.js'

/**
 * Collapse the polymorphic DDISA `act` claim into the binary actor type.
 *
 * Per the spec (`DDISAAssertionClaims.act`) the claim is a string
 * (free-form actor type) OR an RFC 8693 delegation object `{ sub }`
 * naming the delegate actually performing the action. A delegation
 * object MUST normalize to `'agent'`: whoever acts under it is a
 * delegate operating within a grant (delegation.md §5.2), never an
 * unrestricted first-party human — treating it as `'human'` would let
 * a delegated token bypass every scope check keyed on `act === 'human'`.
 *
 * Fail-closed: only the literal string `'human'` yields `'human'`.
 * Anything else — missing claim, unknown strings, malformed objects —
 * yields `'agent'`, the more restrictive classification, so a
 * misbehaving issuer can only ever narrow privileges, not widen them.
 */
export function normalizeActClaim(act: unknown): ActorType {
  return act === 'human' ? 'human' : 'agent'
}
