import type { H3Event } from 'h3'
import type { GitAccess } from './git-access'
import { createError } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { accessAllows, accessFromGrants } from './git-access'
import { useGrantStore } from './grant-store'
import { findRepo } from './repos'

/**
 * Session/bearer caller with at least `required` access on the repo: the
 * owner (implicitly admin), or anyone holding an approved git:* grant.
 * Unknown repo and no-access both answer 404 so the API doesn't leak which
 * repos exist; too little access on a repo the caller can read is a 403.
 */
export async function requireRepoAccess(event: H3Event, owner: string, name: string, required: GitAccess) {
  const caller = await requireCaller(event)
  const repo = await findRepo(owner, name)
  if (!repo) throw createError({ statusCode: 404, statusMessage: 'repo not found' })
  if (repo.ownerEmail === caller.email) return { repo, caller, access: 'admin' as GitAccess }

  const config = useRuntimeConfig()
  const clientId = (config.openapeSp as { clientId?: string })?.clientId ?? 'repos.openape.ai'
  const grants = await useGrantStore().findByDelegate(caller.email)
  const access = accessFromGrants(grants, caller.email, owner, name, clientId)
  if (!access) throw createError({ statusCode: 404, statusMessage: 'repo not found' })
  if (!accessAllows(access, required))
    throw createError({ statusCode: 403, statusMessage: `git:${required} required on this repo` })
  return { repo, caller, access }
}

export async function requireRepoRead(event: H3Event, owner: string, name: string) {
  return (await requireRepoAccess(event, owner, name, 'read')).repo
}
