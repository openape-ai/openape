import { defineEventHandler, getRouterParam } from 'h3'
import { removeTierShape } from '../../utils/shape-tiers'
import { readShapeScope, requireShapeWriter } from '../../utils/shape-writer'

/**
 * DELETE /api/shapes/:cliId[?scope=personal|domain|instance]
 *
 * Removes one shape of one tier, the signed-in human owner's personal shape
 * by default (issues 1551, 1553). Continuing grants resolved with it stop
 * being reused at once; exact-command grants are untouched.
 */
export default defineEventHandler(async (event) => {
  const writer = await requireShapeWriter(event, readShapeScope(event, 'personal'))
  return await removeTierShape(writer, decodeURIComponent(getRouterParam(event, 'cliId') ?? ''))
})
