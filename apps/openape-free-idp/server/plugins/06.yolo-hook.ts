// Registers the YOLO pre-approval hook with @openape/nuxt-auth-idp and
// ensures the yolo_policies table exists. Owns the app's YOLO feature
// end-to-end; the module knows nothing about YOLO specifically.
import { sql } from 'drizzle-orm'
import { resolveServerShape } from '@openape/grants'
import { useDb } from '../database/drizzle'
import { useYoloPolicyStore  } from '../utils/yolo-policy-store'
import type { RiskLevel } from '../utils/yolo-policy-store'
import { commandFromRequest, evaluateYoloPolicy } from '../utils/yolo-evaluator'

export default defineNitroPlugin(async () => {
  // Idempotent schema ensure — safe on every boot, needed under OPENAPE_E2E=1
  // too (where 02.database.ts short-circuits).
  try {
    const db = useDb()
    await db.run(sql`CREATE TABLE IF NOT EXISTS yolo_policies (
      agent_email TEXT PRIMARY KEY,
      enabled_by TEXT NOT NULL,
      deny_risk_threshold TEXT,
      deny_patterns TEXT NOT NULL DEFAULT '[]',
      enabled_at INTEGER NOT NULL,
      expires_at INTEGER,
      updated_at INTEGER NOT NULL
    )`)
  }
  catch (err) {
    console.error('[yolo] yolo_policies table init failed:', err)
  }

  definePreApprovalHook(async (_event, request) => {
    let store
    try { store = useYoloPolicyStore() }
    catch { return null } // DB not wired (e.g. unit tests)

    const policy = await store.get(request.requester)
    if (!policy) return null

    const cmd = commandFromRequest(request)
    let resolvedRisk: RiskLevel | null = null
    if (policy.denyRiskThreshold && cmd && cmd.length > 0) {
      try {
        const shapeStore = useShapeStore()
        const resolved = await resolveServerShape(shapeStore, cmd[0]!, cmd)
        resolvedRisk = (resolved.synthetic ? 'high' : resolved.detail.risk) as RiskLevel
      }
      catch {
        resolvedRisk = 'high'
      }
    }

    const result = evaluateYoloPolicy({ policy, command: cmd, resolvedRisk })
    return result ? { kind: result.kind, decidedBy: result.decidedBy } : null
  })
})
