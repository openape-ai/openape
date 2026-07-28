import { createError, defineEventHandler, getQuery, sendRedirect, useSession } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

/**
 * DEV ONLY — seed an openape-sp session without the DDISA round-trip, so the
 * diff/review UI can be exercised locally. Refuses to run outside dev.
 * GET /api/dev/login?email=you@x&act=human
 */
export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404 })
  const q = getQuery(event)
  const email = typeof q.email === 'string' ? q.email : 'patrick@hofmann.eco'
  const act = q.act === 'agent' ? 'agent' : 'human'
  const sessionSecret = (useRuntimeConfig().openapeSp as { sessionSecret?: string }).sessionSecret!
  const session = await useSession<{ claims: { sub: string, email: string, act: string } }>(event, { name: 'openape-sp', password: sessionSecret })
  await session.update({ claims: { sub: email, email, act } })
  return sendRedirect(event, '/prs')
})
