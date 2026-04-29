import type { AuditEntry } from './types.js'

/**
 * Format the request target for the stderr summary line. For HTTP forward-proxy
 * the path starts with `/` (so `${domain}${path}` reads `example.com/foo`), but
 * for CONNECT the path field already carries `host:port` and concatenating
 * with `domain` would print `example.comexample.com:443`.
 */
function formatTarget(entry: AuditEntry): string {
  return entry.path.startsWith('/') ? `${entry.domain}${entry.path}` : entry.path
}

/**
 * Emit one operator-readable audit summary line to stderr. Intentionally NOT a
 * tamper-proof audit trail: anything written on the user's machine is also
 * writable by the user, so there's no integrity story we'd be willing to put
 * in front of a reviewer. The trustworthy audit lives server-side, recorded
 * by the IdP every time it processes a grant request — see the planned
 * per-agent audit route on `id.openape.ai`.
 *
 * Stderr here is purely a debugging convenience for the operator running
 * `apes proxy --` interactively. Persist nothing locally.
 */
export function writeAudit(entry: AuditEntry): void {
  const grantSuffix = entry.grant_id ? ` grant=${entry.grant_id}` : ''
  console.error(`[audit] ${entry.action} ${entry.method} ${formatTarget(entry)}${grantSuffix}`)
}
