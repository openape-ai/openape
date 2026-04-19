import { defineEventHandler, readBody } from 'h3'
import { useIdpStores } from '../../utils/stores'
import { useGrantStores } from '../../utils/grant-stores'
import { requireAuth } from '../../utils/admin'
import { createProblemError } from '../../utils/problem'
import { seedDefaultSafeCommands } from '../../utils/seed-safe-commands'

/**
 * POST /api/standing-grants/bulk-seed
 *
 * Body: { delegates: string[] }
 *
 * For each delegate in the list that is owned by the caller (session user),
 * seed the canonical default safe-command standing grants. Unowned or unknown
 * delegates are silently skipped (0 created, 0 skipped) to avoid leaking
 * ownership info.
 *
 * Idempotent: already-present default safe-command SGs are counted as skipped.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireAuth(event)
  const body = await readBody<{ delegates?: unknown }>(event)

  if (!Array.isArray(body?.delegates) || body.delegates.length === 0) {
    throw createProblemError({ status: 400, title: 'delegates must be a non-empty array' })
  }
  if (body.delegates.length > 50) {
    throw createProblemError({ status: 400, title: 'delegates may not exceed 50 entries' })
  }
  const delegates: string[] = []
  for (const d of body.delegates) {
    if (typeof d !== 'string' || d.length === 0 || d.length > 255) {
      throw createProblemError({ status: 400, title: 'each delegate must be a non-empty string (≤255 chars)' })
    }
    delegates.push(d)
  }

  const { userStore } = useIdpStores()
  const { grantStore } = useGrantStores()
  const myAgents = await userStore.findByOwner(owner)
  const ownedEmails = new Set(myAgents.map(a => a.email))

  const results: Array<{ delegate: string, created: number, skipped: number }> = []
  for (const delegate of delegates) {
    if (!ownedEmails.has(delegate)) {
      results.push({ delegate, created: 0, skipped: 0 })
      continue
    }
    const r = await seedDefaultSafeCommands(delegate, owner, grantStore)
    results.push({ delegate, ...r })
  }
  return { results }
})
