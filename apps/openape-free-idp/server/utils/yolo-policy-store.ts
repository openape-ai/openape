// App-level YOLO-Policy store. Drizzle-backed; consumed by the YOLO
// Nitro plugin + API handlers.
import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { yoloPolicies } from '../database/schema'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface YoloPolicy {
  agentEmail: string
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
  get: (agentEmail: string) => Promise<YoloPolicy | null>
  put: (policy: YoloPolicy) => Promise<void>
  delete: (agentEmail: string) => Promise<void>
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
    async get(email) {
      const rows = await db.select().from(yoloPolicies).where(eq(yoloPolicies.agentEmail, email)).limit(1)
      return rows[0] ? mapRow(rows[0]) : null
    },

    async put(policy) {
      const values = {
        agentEmail: policy.agentEmail,
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
          target: yoloPolicies.agentEmail,
          set: {
            enabledBy: values.enabledBy,
            denyRiskThreshold: values.denyRiskThreshold,
            denyPatterns: values.denyPatterns,
            expiresAt: values.expiresAt,
            updatedAt: values.updatedAt,
          },
        })
    },

    async delete(email) {
      await db.delete(yoloPolicies).where(eq(yoloPolicies.agentEmail, email))
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
