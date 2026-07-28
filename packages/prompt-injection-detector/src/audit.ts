// Audit store for prompt-injection detections (#463).
// Persists detection events to a per-agent JSONL audit log so the owner
// can review what was blocked and tune thresholds.
//
// The audit log is append-only JSONL (one JSON object per line) for:
// - Simple streaming writes
// - Easy grep/analysis
// - No database dependency

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DetectionResult, SenderContext } from './types.js'

export interface AuditEntry {
  /** ISO timestamp of the detection. */
  timestamp: string
  /** The message text that was analyzed (truncated to 500 chars). */
  messageText: string
  /** Sender context. */
  sender: SenderContext
  /** Detection result from the backend. */
  result: DetectionResult
  /** Whether the message was blocked (score >= threshold). */
  blocked: boolean
  /** The threshold that was applied. */
  threshold: number
}

/**
 * Creates an audit store for a specific agent.
 * The audit log is stored at ~/.openape/agents/<agent-email>/injection-audit.jsonl
 */
export function createAuditStore(agentEmail: string): AuditStore {
  const auditDir = path.join(process.env.HOME || '', '.openape', 'agents', agentEmail)
  const auditFile = path.join(auditDir, 'injection-audit.jsonl')

  return {
    async log(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
      const fullEntry: AuditEntry = {
        ...entry,
        timestamp: new Date().toISOString(),
      }

      // Ensure directory exists
      await fs.mkdir(auditDir, { recursive: true })

      // Append as JSONL
      const line = `${JSON.stringify(fullEntry)}\n`
      await fs.appendFile(auditFile, line, 'utf-8')
    },

    async getRecent(limit = 100): Promise<AuditEntry[]> {
      try {
        const content = await fs.readFile(auditFile, 'utf-8')
        const lines = content.trim().split('\n').filter(Boolean)
        const entries = lines.map(line => JSON.parse(line) as AuditEntry)
        // Return most recent first
        return entries.slice(-limit).reverse()
      }
      catch {
        // File doesn't exist yet or read error
        return []
      }
    },

    async getBlocked(limit = 50): Promise<AuditEntry[]> {
      const all = await this.getRecent(1000)
      return all.filter(e => e.blocked).slice(0, limit)
    },

    async clear(): Promise<void> {
      try {
        await fs.writeFile(auditFile, '', 'utf-8')
      }
      catch (err) {
        // File might not exist
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err
        }
      }
    },
  }
}

export interface AuditStore {
  /** Log a detection event. */
  log: (entry: Omit<AuditEntry, 'timestamp'>) => Promise<void>
  /** Get recent audit entries (most recent first). */
  getRecent: (limit?: number) => Promise<AuditEntry[]>
  /** Get only blocked entries. */
  getBlocked: (limit?: number) => Promise<AuditEntry[]>
  /** Clear the audit log. */
  clear: () => Promise<void>
}
