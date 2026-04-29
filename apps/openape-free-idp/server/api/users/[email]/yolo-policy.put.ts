import { defineEventHandler, getQuery, getRouterParam, readBody } from 'h3'
import { requireYoloPolicyActor } from '../../../utils/yolo-policy-auth'
import {
  AUDIENCE_WILDCARD,
  useYoloPolicyStore,
  YOLO_MODES,

} from '../../../utils/yolo-policy-store'
import type { RiskLevel, YoloMode, YoloPolicy } from '../../../utils/yolo-policy-store'

const VALID_RISK: RiskLevel[] = ['low', 'medium', 'high', 'critical']
const MAX_PATTERNS = 64
const MAX_PATTERN_LEN = 200

export default defineEventHandler(async (event) => {
  const agentEmail = decodeURIComponent(getRouterParam(event, 'email') || '')
  if (!agentEmail) throw createProblemError({ status: 400, title: 'Email is required' })

  const caller = await requireYoloPolicyActor(event, agentEmail)
  const body = await readBody<{
    mode?: YoloMode
    denyRiskThreshold?: RiskLevel | null
    denyPatterns?: string[]
    allowPatterns?: string[]
    expiresAt?: number | null
  }>(event)

  if (body.mode !== undefined && !YOLO_MODES.includes(body.mode)) {
    throw createProblemError({ status: 400, title: `mode must be one of: ${YOLO_MODES.join(', ')}` })
  }

  if (body.denyRiskThreshold !== undefined && body.denyRiskThreshold !== null && !VALID_RISK.includes(body.denyRiskThreshold)) {
    throw createProblemError({ status: 400, title: `denyRiskThreshold must be one of: ${VALID_RISK.join(', ')}` })
  }
  validatePatternList(body.denyPatterns, 'denyPatterns')
  validatePatternList(body.allowPatterns, 'allowPatterns')
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (!Number.isFinite(body.expiresAt) || body.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw createProblemError({ status: 400, title: 'expiresAt must be a future unix-seconds timestamp' })
    }
  }

  // Audience scope: optional `?audience=` query param. Defaults to the
  // wildcard so unmodified UI calls (which don't yet pass audience) keep
  // writing the per-agent fallback row.
  const audience = (getQuery(event).audience as string | undefined)?.trim() || AUDIENCE_WILDCARD

  const store = useYoloPolicyStore()
  const existing = await store.getExact(agentEmail, audience)
  const now = Math.floor(Date.now() / 1000)
  const policy: YoloPolicy = {
    agentEmail,
    audience,
    mode: body.mode ?? existing?.mode ?? 'deny-list',
    enabledBy: caller === '_management_' ? (existing?.enabledBy ?? caller) : caller,
    denyRiskThreshold: body.denyRiskThreshold !== undefined ? body.denyRiskThreshold : (existing?.denyRiskThreshold ?? null),
    denyPatterns: body.denyPatterns !== undefined ? normalisePatterns(body.denyPatterns) : (existing?.denyPatterns ?? []),
    allowPatterns: body.allowPatterns !== undefined ? normalisePatterns(body.allowPatterns) : (existing?.allowPatterns ?? []),
    enabledAt: existing?.enabledAt ?? now,
    expiresAt: body.expiresAt !== undefined ? body.expiresAt : (existing?.expiresAt ?? null),
    updatedAt: now,
  }
  await store.put(policy)
  return { policy }
})

function normalisePatterns(input: string[]): string[] {
  const out: string[] = []
  for (const p of input) {
    const trimmed = p.trim()
    if (trimmed && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

function validatePatternList(input: string[] | undefined, fieldName: string): void {
  if (input === undefined) return
  if (!Array.isArray(input)) {
    throw createProblemError({ status: 400, title: `${fieldName} must be an array of strings` })
  }
  if (input.length > MAX_PATTERNS) {
    throw createProblemError({ status: 400, title: `${fieldName} may contain at most ${MAX_PATTERNS} entries` })
  }
  for (const p of input) {
    if (typeof p !== 'string' || p.length === 0 || p.length > MAX_PATTERN_LEN) {
      throw createProblemError({ status: 400, title: `Each entry in ${fieldName} must be a non-empty string up to ${MAX_PATTERN_LEN} chars` })
    }
  }
}
