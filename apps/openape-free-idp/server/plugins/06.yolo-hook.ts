// Registers the YOLO pre-approval hook with @openape/nuxt-auth-idp and
// ensures the yolo_policies table exists. Owns the app's YOLO feature
// end-to-end; the module knows nothing about YOLO specifically.
import { sql } from 'drizzle-orm'
import { resolveServerShape } from '@openape/grants'
import { useDb } from '../database/drizzle'
import { useYoloPolicyStore  } from '../utils/yolo-policy-store'
import type { RiskLevel } from '../utils/yolo-policy-store'
import { commandFromRequest, evaluateYoloPolicy, targetFromRequest } from '../utils/yolo-evaluator'

export default defineNitroPlugin(async () => {
  // Idempotent schema ensure — safe on every boot, needed under OPENAPE_E2E=1
  // too (where 02.database.ts short-circuits).
  //
  // Schema evolution: started as `agent_email PRIMARY KEY` (one YOLO policy
  // per agent, applied to all audiences). M3 split it per-audience so an
  // operator can YOLO `ape-proxy` without YOLOing `ape-shell`. The migration
  // is a recreate-from-old (SQLite can't change a PK in place) and is gated
  // on the absence of the `audience` column so it runs at most once per DB.
  try {
    const db = useDb()
    // Fresh-DB shape (composite PK + mode + split pattern lists).
    await db.run(sql`CREATE TABLE IF NOT EXISTS yolo_policies (
      agent_email TEXT NOT NULL,
      audience TEXT NOT NULL DEFAULT '*',
      mode TEXT NOT NULL DEFAULT 'deny-list',
      enabled_by TEXT NOT NULL,
      deny_risk_threshold TEXT,
      deny_patterns TEXT NOT NULL DEFAULT '[]',
      allow_patterns TEXT NOT NULL DEFAULT '[]',
      enabled_at INTEGER NOT NULL,
      expires_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (agent_email, audience)
    )`)

    // Migration path: existing prod tables created from the old schema have a
    // single-column PK on agent_email and no audience column. Detect that
    // and rebuild.
    const cols = await db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info('yolo_policies')`)
    const colNames = Array.isArray(cols) ? cols.map((c: { name: string }) => c.name) : []
    const hasAudience = colNames.includes('audience')
    const hasMode = colNames.includes('mode')
    const hasAllowPatterns = colNames.includes('allow_patterns')
    if (!hasAudience) {
      console.warn('[yolo] migrating yolo_policies → composite (agent_email, audience) PK')
      await db.run(sql`CREATE TABLE yolo_policies_v2 (
        agent_email TEXT NOT NULL,
        audience TEXT NOT NULL DEFAULT '*',
        enabled_by TEXT NOT NULL,
        deny_risk_threshold TEXT,
        deny_patterns TEXT NOT NULL DEFAULT '[]',
        enabled_at INTEGER NOT NULL,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (agent_email, audience)
      )`)
      await db.run(sql`INSERT INTO yolo_policies_v2 (agent_email, audience, enabled_by, deny_risk_threshold, deny_patterns, enabled_at, expires_at, updated_at)
        SELECT agent_email, '*', enabled_by, deny_risk_threshold, deny_patterns, enabled_at, expires_at, updated_at FROM yolo_policies`)
      await db.run(sql`DROP TABLE yolo_policies`)
      await db.run(sql`ALTER TABLE yolo_policies_v2 RENAME TO yolo_policies`)
      console.warn('[yolo] migration complete')
    }

    // M3.5: add `mode` column (allow-list vs deny-list) to existing tables.
    // ALTER TABLE ADD COLUMN with NOT NULL + DEFAULT works in SQLite for
    // existing rows; new rows pick up the default. Idempotent via try/catch
    // when the column is already present.
    if (!hasMode) {
      try {
        await db.run(sql`ALTER TABLE yolo_policies ADD COLUMN mode TEXT NOT NULL DEFAULT 'deny-list'`)
        console.warn('[yolo] added `mode` column (default deny-list)')
      }
      catch (err) {
        // Could already be there if the migration block above just ran (it
        // creates the table with `mode`). Tolerate silently.
        if (!String(err).includes('duplicate column')) {
          console.error('[yolo] mode-column migration failed:', err)
        }
      }
    }

    // Split pattern lists per mode. Old rows used `deny_patterns` for both
    // modes — in `mode='allow-list'` the same column was being read as the
    // allow-list. Add `allow_patterns` and one-shot move existing allow-list
    // rows' patterns into the new column. Idempotent: gated on column absence
    // and clears `deny_patterns` on the moved rows so re-running this is a
    // no-op for them too.
    if (!hasAllowPatterns) {
      try {
        await db.run(sql`ALTER TABLE yolo_policies ADD COLUMN allow_patterns TEXT NOT NULL DEFAULT '[]'`)
        await db.run(sql`UPDATE yolo_policies
          SET allow_patterns = deny_patterns, deny_patterns = '[]'
          WHERE mode = 'allow-list' AND deny_patterns != '[]'`)
        console.warn('[yolo] added `allow_patterns` column and moved existing allow-list rows over')
      }
      catch (err) {
        if (!String(err).includes('duplicate column')) {
          console.error('[yolo] allow_patterns migration failed:', err)
        }
      }
    }
  }
  catch (err) {
    console.error('[yolo] yolo_policies table init / migration failed:', err)
  }

  definePreApprovalHook(async (_event, request) => {
    let store
    try { store = useYoloPolicyStore() }
    catch { return null } // DB not wired (e.g. unit tests)

    // Most-specific lookup: try (requester, request.audience) first, then
    // fall through to (requester, '*'). Lets an operator YOLO `ape-proxy`
    // without YOLOing `ape-shell` (or vice versa).
    const policy = await store.get(request.requester, request.audience)
    if (!policy) return null

    // Risk-threshold lookup needs an executable to score, which only exists
    // for Commands/Root grants. Web grants (ape-proxy) carry no command —
    // the evaluator just match-globs against target_host instead.
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

    const target = targetFromRequest(request)
    const result = evaluateYoloPolicy({ policy, target, resolvedRisk })
    return result ? { kind: result.kind, decidedBy: result.decidedBy } : null
  })
})
