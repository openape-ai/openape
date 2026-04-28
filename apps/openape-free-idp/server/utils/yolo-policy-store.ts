// App-level YOLO-Policy store. Drizzle-backed; consumed by the YOLO
// Nitro plugin + API handlers.
import { and, eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { yoloPolicies } from '../database/schema'
import { AUDIENCE_WILDCARD } from './audience-buckets'

export { AUDIENCE_WILDCARD }
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface YoloPolicy {
  agentEmail: string
  /**
   * Audience scope. `'*'` matches all audiences as a per-agent fallback;
   * any other value (e.g. `'ape-proxy'`, `'ape-shell'`) is a more-specific
   * override. The IdP's pre-approval hook does most-specific-wins lookup:
   * try (agent, request.audience) first, then fall back to (agent, '*').
   */
  audience: string
  enabledBy: string
  /** Auto-approval stops when the resolved shape risk meets or exceeds this. */
  denyRiskThreshold: RiskLevel | null
  /** Glob patterns that drop the request back to the normal approval flow. */
  denyPatterns: string[]
  enabledAt: number
  /** Unix seconds; null = no expiry. */
  expiresAt: number | null
  updatedAt: number
}

export interface YoloPolicyStore {
  /**
   * Look up the most-specific policy for (agentEmail, audience). Tries the
   * exact audience first; if no row matches, falls back to the agent's
   * wildcard ('*') row. Returns null only if neither exists.
   */
  get: (agentEmail: string, audience?: string) => Promise<YoloPolicy | null>
  /**
   * Look up an exact (agentEmail, audience) row. No fallback. Used by the
   * UI / API layer when the operator explicitly asks for the wildcard or a
   * specific audience.
   */
  getExact: (agentEmail: string, audience: string) => Promise<YoloPolicy | null>
  put: (policy: YoloPolicy) => Promise<void>
  delete: (agentEmail: string, audience: string) => Promise<void>
  /** All policies for an agent across all audiences. */
  listForAgent: (agentEmail: string) => Promise<YoloPolicy[]>
  /** All policies system-wide. */
  list: () => Promise<YoloPolicy[]>
}

type Row = typeof yoloPolicies.$inferSelect

function mapRow(row: Row): YoloPolicy {
  let patterns: string[] = []
  if (Array.isArray(row.denyPatterns)) {
    patterns = (row.denyPatterns as unknown[]).filter((p): p is string => typeof p === 'string')
  }
  else if (typeof row.denyPatterns === 'string') {
    try {
      const parsed = JSON.parse(row.denyPatterns)
      if (Array.isArray(parsed)) {
        patterns = parsed.filter((p): p is string => typeof p === 'string')
      }
    }
    catch { /* leave empty */ }
  }
  return {
    agentEmail: row.agentEmail,
    audience: row.audience ?? AUDIENCE_WILDCARD,
    enabledBy: row.enabledBy,
    denyRiskThreshold: (row.denyRiskThreshold ?? null) as YoloPolicy['denyRiskThreshold'],
    denyPatterns: patterns,
    enabledAt: row.enabledAt,
    expiresAt: row.expiresAt ?? null,
    updatedAt: row.updatedAt,
  }
}

export function createDrizzleYoloPolicyStore(): YoloPolicyStore {
  const db = useDb()

  return {
    async get(email, audience) {
      // Most-specific match first, then wildcard fallback. Two queries instead
      // of a single `IN ('audience', '*')` because we want deterministic
      // ordering — SQLite would order by row insertion otherwise.
      if (audience && audience !== AUDIENCE_WILDCARD) {
        const exact = await db.select().from(yoloPolicies).where(and(eq(yoloPolicies.agentEmail, email), eq(yoloPolicies.audience, audience))).limit(1)
        if (exact[0]) return mapRow(exact[0])
      }
      const fallback = await db.select().from(yoloPolicies).where(and(eq(yoloPolicies.agentEmail, email), eq(yoloPolicies.audience, AUDIENCE_WILDCARD))).limit(1)
      return fallback[0] ? mapRow(fallback[0]) : null
    },

    async getExact(email, audience) {
      const rows = await db.select().from(yoloPolicies).where(and(eq(yoloPolicies.agentEmail, email), eq(yoloPolicies.audience, audience))).limit(1)
      return rows[0] ? mapRow(rows[0]) : null
    },

    async put(policy) {
      const values = {
        agentEmail: policy.agentEmail,
        audience: policy.audience,
        enabledBy: policy.enabledBy,
        denyRiskThreshold: policy.denyRiskThreshold,
        denyPatterns: policy.denyPatterns,
        enabledAt: policy.enabledAt,
        expiresAt: policy.expiresAt,
        updatedAt: policy.updatedAt,
      }
      await db
        .insert(yoloPolicies)
        .values(values)
        .onConflictDoUpdate({
          target: [yoloPolicies.agentEmail, yoloPolicies.audience],
          set: {
            enabledBy: values.enabledBy,
            denyRiskThreshold: values.denyRiskThreshold,
            denyPatterns: values.denyPatterns,
            expiresAt: values.expiresAt,
            updatedAt: values.updatedAt,
          },
        })
    },

    async delete(email, audience) {
      await db.delete(yoloPolicies)
        .where(and(eq(yoloPolicies.agentEmail, email), eq(yoloPolicies.audience, audience)))
    },

    async listForAgent(email) {
      const rows = await db.select().from(yoloPolicies).where(eq(yoloPolicies.agentEmail, email))
      return rows.map(mapRow)
    },

    async list() {
      const rows = await db.select().from(yoloPolicies)
      return rows.map(mapRow)
    },
  }
}

let _singleton: YoloPolicyStore | null = null
export function useYoloPolicyStore(): YoloPolicyStore {
  if (!_singleton) _singleton = createDrizzleYoloPolicyStore()
  return _singleton
}
