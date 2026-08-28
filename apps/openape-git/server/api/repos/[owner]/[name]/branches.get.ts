import { defineEventHandler, getRouterParam } from 'h3'
import { listBranches } from '../../../../utils/git-read'
import { requireRepoRead } from '../../../../utils/repo-access'
import { repoDiskPath } from '../../../../utils/repos'

/** GET /api/repos/:owner/:name/branches — branch list, newest commit first. */
export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  const repo = await requireRepoRead(event, owner, name)

  const branches = await listBranches(repoDiskPath(owner, name))
  return { defaultBranch: repo.defaultBranch, branches }
})
