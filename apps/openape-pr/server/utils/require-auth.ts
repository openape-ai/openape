import type { H3Event } from 'h3'
import { createProblemError } from './problem'

// `requireCaller` (and the `Caller` type) are auto-imported from
// @openape/nuxt-auth-sp — the shared DDISA-SP bearer/session auth lives in the
// module now, so this file only carries pr's app-specific guard.

/**
 * Like requireCaller, but rejects agents. Reviewing a PR is a human decision —
 * agents upload PRs and poll the verdict, they never submit one.
 */
export async function requireHuman(event: H3Event) {
  const caller = await requireCaller(event)
  if (caller.act !== 'human') {
    throw createProblemError({ status: 403, title: 'Forbidden', detail: 'Only a human reviewer can submit a review.' })
  }
  return caller
}
