import { defineEventHandler } from 'h3'
import { requireCaller } from '../../utils/require-auth'

/**
 * GET /api/cli/me — bearer-aware identity probe.
 *
 * The stock /api/me (shipped by @openape/nuxt-auth-sp) only recognises the
 * browser session cookie. The CLI carries a locally-issued bearer token, so
 * we expose this second endpoint that goes through our requireCaller helper
 * (which accepts session cookies and both CLI + agent bearer tokens).
 *
 * Response: { email, act }
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  return { email: caller.email, act: caller.act }
})
