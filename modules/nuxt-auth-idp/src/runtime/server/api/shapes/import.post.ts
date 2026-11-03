import { defineEventHandler, getQuery, readBody } from 'h3'
import { importShapes } from '../../utils/shape-tiers'
import { readShapeScope, requireShapeWriter } from '../../utils/shape-writer'

/**
 * POST /api/shapes/import?scope=instance|domain|personal[&dry_run=1]
 * body `{ shapes: [{ toml, description? }], prune?: boolean, source?: { repo?, commit?, dirty? } }`
 *
 * Writes one batch of one shape tier, all or nothing (issue 1553): IdP-wide
 * shapes with the management token, domain shapes by a root admin or
 * operator of their own email domain, personal shapes by the human owner.
 * The answer lists added, changed and removed shapes and the grants they
 * affect; every write is audited in `shape_changes`. An unchanged repeat
 * writes nothing. `source` is recorded as claimed, never verified.
 */
export default defineEventHandler(async (event) => {
  const writer = await requireShapeWriter(event, readShapeScope(event))
  const dryRun = ['1', 'true'].includes(String(getQuery(event).dry_run ?? ''))
  return await importShapes(writer, await readBody(event), dryRun)
})
