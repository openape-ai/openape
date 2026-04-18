import { defineEventHandler, getRouterParam } from 'h3'
import { useShapeStore } from '../../utils/shape-store'
import { createProblemError } from '../../utils/problem'

/**
 * GET /api/shapes/:cliId
 *
 * Returns a single shape by CLI id or 404 if not found. Public.
 */
export default defineEventHandler(async (event) => {
  const cliId = decodeURIComponent(getRouterParam(event, 'cliId') ?? '')
  if (!cliId) {
    throw createProblemError({ status: 400, title: 'Missing cli_id' })
  }
  const shape = await useShapeStore().getShape(cliId)
  if (!shape) {
    throw createProblemError({ status: 404, title: `Shape not found: ${cliId}` })
  }
  return shape
})
