import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Single audit log entry. Always includes a timestamp and an action string. */
export interface AuditEntry {
  action: string
  timestamp: number
  [key: string]: unknown
}

function auditPath(): string {
  return join(homedir(), '.config', 'apes', 'audit.jsonl')
}

/**
 * Append a single entry to the audit log at ~/.config/apes/audit.jsonl.
 * Failures are swallowed — the audit log should never break the actual flow.
 */
export function appendAuditLog(entry: { action: string, timestamp?: number } & Record<string, unknown>): void {
  const full: AuditEntry = {
    ...entry,
    action: entry.action,
    timestamp: entry.timestamp ?? Date.now(),
  }
  const path = auditPath()
  const dir = dirname(path)
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(path, `${JSON.stringify(full)}\n`)
  }
  catch {
    // intentionally ignored — audit log must never break the flow
  }
}
