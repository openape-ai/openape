import { useIdpStorage } from './storage'

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

export function createYoloPolicyStore(): YoloPolicyStore {
  const storage = useIdpStorage()
  const key = (email: string) => `yolo-policies:${email}`

  return {
    async get(email) {
      return (await storage.getItem<YoloPolicy>(key(email))) || null
    },
    async put(policy) {
      await storage.setItem(key(policy.agentEmail), policy)
    },
    async delete(email) {
      await storage.removeItem(key(email))
    },
    async list() {
      const keys = await storage.getKeys('yolo-policies:')
      const out: YoloPolicy[] = []
      for (const k of keys) {
        const v = await storage.getItem<YoloPolicy>(k)
        if (v) out.push(v)
      }
      return out
    },
  }
}
