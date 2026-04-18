import { defineEventHandler, readBody } from 'h3'
import { resolveServerShape } from '@openape/grants'
import { useShapeStore } from '../../utils/shape-store'
import { createProblemError } from '../../utils/problem'

/**
 * POST /api/shapes/resolve
 *
 * Body: `{ cli_id: string, argv: string[], target_host?: string }`
 *
 * Resolves raw argv against the server-side shape registry and returns a
 * structured `ServerResolvedCommand`. When no shape matches, returns the
 * generic fallback (`operation_id: "_generic.exec"`, `risk: "high"`,
 * `exact_command: true`).
 *
 * Public endpoint — resolution is pure and non-sensitive; callers still
 * need to post the full grant request to `/api/grants` to actually request
 * access. This endpoint exists so clients (and future the UI) can preview
 * a request's shape before creating a grant.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ cli_id?: string, argv?: string[], target_host?: string }>(event)
  if (!body?.cli_id || typeof body.cli_id !== 'string') {
    throw createProblemError({ status: 400, title: 'Missing required field: cli_id' })
  }
  if (!Array.isArray(body.argv) || body.argv.length === 0) {
    throw createProblemError({ status: 400, title: 'argv must be a non-empty array (first element is the executable)' })
  }
  if (body.argv.some(t => typeof t !== 'string')) {
    throw createProblemError({ status: 400, title: 'argv entries must be strings' })
  }
  return await resolveServerShape(useShapeStore(), body.cli_id, body.argv)
})
