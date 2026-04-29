import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AuditEntry } from './types.js'

let auditPath: string | undefined
let auditDirReady = false

export function initAudit(path?: string): void {
  auditPath = path
  auditDirReady = false
}

/**
 * Format the request target for the stderr summary line. For HTTP forward-proxy
 * the path starts with `/` (so `${domain}${path}` reads `example.com/foo`), but
 * for CONNECT the path field already carries `host:port` and concatenating
 * with `domain` would print `example.comexample.com:443`.
 */
function formatTarget(entry: AuditEntry): string {
  return entry.path.startsWith('/') ? `${entry.domain}${entry.path}` : entry.path
}

export function writeAudit(entry: AuditEntry): void {
  const grantSuffix = entry.grant_id ? ` grant=${entry.grant_id}` : ''
  console.error(`[audit] ${entry.action} ${entry.method} ${formatTarget(entry)}${grantSuffix}`)

  if (!auditPath) return

  // Lazy mkdir-p so the default `~/.local/state/openape/` path works on a
  // fresh machine without operator setup. Done once per `initAudit` call.
  if (!auditDirReady) {
    try {
      mkdirSync(dirname(auditPath), { recursive: true })
      auditDirReady = true
    }
    catch (err) {
      console.error(`[audit] cannot create dir for ${auditPath}: ${err instanceof Error ? err.message : err} — disabling file audit, stderr line above remains the trail`)
      auditPath = undefined
      return
    }
  }

  // Fail-soft on the actual append: we never want a disk problem to crash a
  // CONNECT tunnel mid-handshake. The stderr line above is the audit fallback.
  try {
    appendFileSync(auditPath, `${JSON.stringify(entry)}\n`)
  }
  catch (err) {
    console.error(`[audit] cannot append to ${auditPath}: ${err instanceof Error ? err.message : err} — disabling file audit, stderr line above remains the trail`)
    auditPath = undefined
  }
}
