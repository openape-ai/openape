// story: coder-invite-members, coder-user-stories (#585).
//
// Project-scoped audit log. Permission changes (coder-invite-members
// criterion 3) and story status changes (coder-user-stories criterion 4) are
// recorded with actor and timestamp; `list` returns the trail newest-first.

import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { desc, eq } from 'drizzle-orm'
import { auditLog } from '../database/schema'
import { useDb } from '../database/drizzle'

export type AuditAction = 'capability.grant' | 'capability.revoke' | 'story.status'

export interface AuditEntry {
  projectId: string
  action: AuditAction
  /** Who triggered the change. */
  actorEmail: string
  /** Which member/story the change targeted. */
  subject: string
  /** Action-specific detail, e.g. the capability name or the new status. */
  detail: string
  /** When (epoch ms). */
  at: number
}

export interface AuditLog {
  record: (entry: Omit<AuditEntry, 'at'>) => Promise<AuditEntry>
  /** Audit trail for a project, newest first — surfaces who did what, when. */
  list: (projectId: string) => Promise<AuditEntry[]>
}

type Db = LibSQLDatabase<Record<string, never>>

export function createAuditLog(db: Db): AuditLog {
  return {
    async record(entry) {
      const at = Date.now()
      await db.insert(auditLog).values({
        id: crypto.randomUUID(),
        projectId: entry.projectId,
        action: entry.action,
        actorEmail: entry.actorEmail,
        subject: entry.subject,
        detail: entry.detail,
        at,
      })
      return { ...entry, at }
    },

    async list(projectId) {
      const rows = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.projectId, projectId))
        .orderBy(desc(auditLog.at))
      return rows.map(r => ({
        projectId: r.projectId,
        action: r.action as AuditAction,
        actorEmail: r.actorEmail,
        subject: r.subject,
        detail: r.detail,
        at: r.at,
      }))
    },
  }
}

export function useAuditLog(): AuditLog {
  return createAuditLog(useDb() as unknown as Db)
}
