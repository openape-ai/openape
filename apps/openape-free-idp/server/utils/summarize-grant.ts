import type { OpenApeGrant } from '@openape/core'

/**
 * Compress a grant request into a single line for the push body.
 * Push notifications truncate aggressively on mobile (often around
 * 100 chars on Android, less on iOS), so prefer the most actionable
 * field: the command being run, falling back to a reason or the bare
 * audience name.
 *
 * Pure helper, no side effects, no nitro/runtime imports — kept in its
 * own file so unit tests can import it without spinning up the Nitro
 * runtime.
 */
export function summarizeRequest(req: OpenApeGrant['request']): string {
  if (Array.isArray(req.command) && req.command.length > 0) {
    const joined = req.command.join(' ')
    return joined.length > 90 ? `${joined.slice(0, 90)}…` : joined
  }
  if (req.reason) {
    return req.reason.length > 90 ? `${req.reason.slice(0, 90)}…` : req.reason
  }
  return req.audience ?? 'grant request'
}
