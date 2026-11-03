import { defineEventHandler, getQuery, getRouterParam, readBody } from 'h3'
import { publishTierShape } from '../../utils/shape-tiers'
import { readShapeScope, requireShapeWriter } from '../../utils/shape-writer'

/**
 * PUT /api/shapes/:cliId[?scope=personal|domain|instance]  body `{ "toml": "<adapter.toml>", "description"?: string }`
 *
 * Publishes one shape of one tier (issues 1551, 1553), the signed-in human
 * owner's personal shape by default; with `?dry_run=1` only previews it.
 * The same import path as `POST /api/shapes/import`, so the same writers,
 * checks and audit apply.
 */
export default defineEventHandler(async (event) => {
  const writer = await requireShapeWriter(event, readShapeScope(event, 'personal'))
  const cliId = decodeURIComponent(getRouterParam(event, 'cliId') ?? '')
  const dryRun = ['1', 'true'].includes(String(getQuery(event).dry_run ?? ''))
  return await publishTierShape(writer, cliId, await readBody(event), dryRun)
})
