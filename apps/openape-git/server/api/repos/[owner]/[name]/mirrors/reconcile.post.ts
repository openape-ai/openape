import { createError, defineEventHandler, getRouterParam } from 'h3'
import { reconcileMirrors } from '../../../../../utils/mirror-reconcile'
import { findRepo } from '../../../../../utils/repos'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const repo = await findRepo(getRouterParam(event, 'owner') ?? '', getRouterParam(event, 'name') ?? '')
  if (!repo || repo.ownerEmail !== caller.email)
    throw createError({ statusCode: 404, statusMessage: 'repo not found' })
  void reconcileMirrors(repo).catch(err => console.error('[ape-git] manual mirror scan failed', err))
  return { queued: true }
})
