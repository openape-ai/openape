import { useDb } from '../../../database/drizzle'
import { cockpitYoloSync } from '../../../database/schema'
import { requireAgentOrg } from '../../../utils/cockpit/agent-org'

const MAX_TOOLS = 128
const MAX_LEN = 200

// After every yolo_sync the worker reports what it pushed to the IdP (or that
// the policy was already current, or that the push failed). Without that report
// troop knows nothing about the policy state — a stale policy then looks in the
// cockpit like "the operator simply isn't allowed to" (incident 2026-07-30, two
// days of `jq *` having no effect). Send `tools` only on ok: on a
// Fehlschlag bleibt die zuletzt WIRKSAME Liste stehen, denn gegen die driftet
// die Rolle.
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    orgId?: string
    opEmail?: string
    mode?: string
    patternCount?: number
    tools?: string[]
    ok?: boolean
    error?: string
  }>(event)
  const orgId = String(body?.orgId || '')
  const owner = await requireAgentOrg(event, orgId)

  const ok = body?.ok !== false
  const tools = Array.isArray(body?.tools)
    ? body.tools.filter(t => typeof t === 'string' && t.length > 0 && t.length <= MAX_LEN).slice(0, MAX_TOOLS)
    : []
  const now = Math.floor(Date.now() / 1000)
  const row = {
    ownerEmail: owner,
    opEmail: String(body?.opEmail || '').slice(0, 255),
    mode: String(body?.mode || '').slice(0, 32),
    patternCount: Number.isFinite(body?.patternCount) ? Math.max(0, Math.floor(body!.patternCount!)) : 0,
    ok,
    error: ok ? '' : String(body?.error || '').slice(0, 500),
    reportedAt: now,
  }
  const db = useDb()
  if (ok) {
    await db.insert(cockpitYoloSync)
      .values({ orgId, ...row, tools, syncedAt: now })
      .onConflictDoUpdate({ target: cockpitYoloSync.orgId, set: { ...row, tools, syncedAt: now } })
  }
  else {
    await db.insert(cockpitYoloSync)
      .values({ orgId, ...row, tools: [], syncedAt: 0 })
      .onConflictDoUpdate({ target: cockpitYoloSync.orgId, set: row })
  }
  return { ok: true }
})
