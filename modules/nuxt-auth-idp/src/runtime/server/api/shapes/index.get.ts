import { defineEventHandler, getQuery } from 'h3'
import { requireBrokerOwner } from '../../utils/broker-owner'
import { listOwnerShapeViews } from '../../utils/owner-shapes'
import { useShapeStore } from '../../utils/shape-store'

/**
 * GET /api/shapes
 *
 * Returns every registry shape, sorted by `cli_id`. Public — shapes are
 * non-sensitive adapter descriptions; exposing them lets UIs and third-party
 * tools discover what's supported.
 *
 * GET /api/shapes?mine=1 returns the signed-in human owner's own shapes
 * with the continuing grants bound to them (issue 1551). Owner shapes are
 * never part of the public list.
 */
export default defineEventHandler(async (event) => {
  if (getQuery(event).mine !== undefined) return await listOwnerShapeViews(await requireBrokerOwner(event))
  return await useShapeStore().listShapes()
})
