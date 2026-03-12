import { appendFileSync } from 'node:fs'
import type { AuditEntry } from './types.js'

let auditPath: string | undefined

export function initAudit(path?: string): void {
  auditPath = path
}

export function writeAudit(entry: AuditEntry): void {
  const line = JSON.stringify(entry)

  // Always log to stderr
  console.error(`[audit] ${entry.action} ${entry.method} ${entry.domain}${entry.path}${entry.grant_id ? ` grant=${entry.grant_id}` : ''}`)

  // Write to file if configured
  if (auditPath) {
    appendFileSync(auditPath, line + '\n')
  }
}
