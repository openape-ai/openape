import type { timeEntries } from '../database/schema'

export const VALID_TYPE = new Set(['code', 'research', 'planning', 'review', 'admin', 'meeting'])
export type EntryType = 'code' | 'research' | 'planning' | 'review' | 'admin' | 'meeting'

type Row = typeof timeEntries.$inferSelect

export function serializeEntry(r: Row) {
  return {
    id: r.id,
    company_id: r.companyId,
    project_id: r.projectId,
    user_email: r.userEmail,
    act: r.act,
    entry_date: r.entryDate,
    duration_minutes: r.durationMinutes,
    started_at: r.startedAt,
    ended_at: r.endedAt,
    description: r.description,
    type: r.type,
    billable: r.billable,
    is_break: r.isBreak,
    created_via: r.createdVia,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    updated_by: r.updatedBy,
  }
}

/** "45" -> 45, "1h30m" -> 90, "2h" -> 120, "90m" -> 90. null on garbage. */
export function parseDurationMinutes(input: string | number | undefined | null): number | null {
  if (input == null) return null
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? Math.floor(input) : null
  const s = input.trim()
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10)
    return n > 0 ? n : null
  }
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?$/)
  if (!m || (!m[1] && !m[2])) return null
  const total = (m[1] ? parseInt(m[1], 10) * 60 : 0) + (m[2] ? parseInt(m[2], 10) : 0)
  return total > 0 ? total : null
}

/** "YYYY-MM-DD" sanity check. */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Every entry must carry a concrete von/bis. When the caller only gave a
 * duration we anchor the block: end = now if the entry is for today, else
 * 17:00Z of the entry date; start = end − duration. Deterministic so the
 * same input always yields the same block.
 */
export function deriveBlock(entryDate: string, durationMinutes: number): { startedAt: number, endedAt: number } {
  const now = Math.floor(Date.now() / 1000)
  const endedAt = entryDate === todayUtc()
    ? now
    : Math.floor(new Date(`${entryDate}T17:00:00Z`).getTime() / 1000)
  return { startedAt: endedAt - durationMinutes * 60, endedAt }
}
