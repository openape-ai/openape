import { defineEventHandler } from 'h3'
import { requireCaller } from '../../utils/require-auth'

/**
 * GET /api/cli/me — bearer-aware identity probe.
 *
 * The stock /api/me only recognises the browser session cookie. The CLI
 * carries a locally-issued bearer token, so this endpoint goes through
 * `requireCaller` (which accepts session cookies and both CLI + agent bearer
 * tokens). Shipped by @openape/nuxt-auth-sp so every SP app gets it for free.
 *
 * Response: { email, act }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  return { email: caller.email, act: caller.act }
})
