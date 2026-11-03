import { defineEventHandler, getQuery } from 'h3'
import { listTierViews } from '../../utils/shape-tiers'
import { readShapeScope, requireShapeReader } from '../../utils/shape-writer'
import { useShapeStore } from '../../utils/shape-store'

/**
 * GET /api/shapes
 *
 * Returns every IdP-wide shape, sorted by `cli_id`. Public — shapes are
 * non-sensitive adapter descriptions; exposing them lets UIs and third-party
 * tools discover what's supported.
 *
 * GET /api/shapes?scope=personal (or `?mine=1`) returns the signed-in human
 * owner's own shapes, `?scope=domain` the shapes of their email domain, each
 * with the continuing grants bound to them (issues 1551, 1553);
 * `?scope=instance` the IdP-wide shapes in the same view. Personal and
 * domain shapes are never part of the public list.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  if (query.mine !== undefined) return await listTierViews(await requireShapeReader(event, 'personal'))
  if (query.scope !== undefined) {
    const scope = readShapeScope(event)
    return await listTierViews(await requireShapeReader(event, scope))
  }
  return await useShapeStore().listShapes()
})
