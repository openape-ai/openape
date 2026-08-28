import type { H3Event } from 'h3'
import { createError } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { accessFromGrants } from './git-access'
import { useGrantStore } from './grant-store'
import { findRepo } from './repos'

/**
 * Session/bearer caller with at least read access on the repo: the owner, or
 * anyone holding an approved git:read+ grant. Unknown repo and no-access both
 * answer 404 so the browse API doesn't leak which repos exist.
 */
export async function requireRepoRead(event: H3Event, owner: string, name: string) {
  const caller = await requireCaller(event)
  const repo = await findRepo(owner, name)
  if (!repo) throw createError({ statusCode: 404, statusMessage: 'repo not found' })
  if (repo.ownerEmail === caller.email) return repo

  const config = useRuntimeConfig()
  const clientId = (config.openapeSp as { clientId?: string })?.clientId ?? 'repos.openape.ai'
  const grants = await useGrantStore().findByDelegate(caller.email)
  const access = accessFromGrants(grants, caller.email, owner, name, clientId)
  if (!access) throw createError({ statusCode: 404, statusMessage: 'repo not found' })
  return repo
}
