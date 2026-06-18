import { parseAgentEmail } from '@openape/core'

/**
 * The human owner behind a caller: an agent maps to its owner (derived from
 * the agent email), a human IS its own owner. This is the org read-access
 * contract — a member agent may read its owner's company. Leaf module (no db /
 * nitro imports) so it is unit-testable in isolation.
 */
export function ownerOf(sub: string, act: 'human' | 'agent'): string {
  return act === 'agent' ? (parseAgentEmail(sub)?.ownerEmail ?? sub) : sub
}
