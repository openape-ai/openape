import { defineEventHandler } from 'h3'
import { useShapeStore } from '../../utils/shape-store'

/**
 * GET /api/shapes
 *
 * Returns every registered shape, sorted by `cli_id`. Public — shapes are
 * non-sensitive adapter descriptions; exposing them lets UIs and third-party
 * tools discover what's supported.
 */
export default defineEventHandler(async () => {
  const store = useShapeStore()
  return await store.listShapes()
})
