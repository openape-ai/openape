import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3'
import { isValidRef } from '../../../../utils/git-parse'
import { listCommits, resolveCommit } from '../../../../utils/git-read'
import { readPushLog } from '../../../../utils/push-log'
import { requireRepoRead } from '../../../../utils/repo-access'
import { repoDiskPath } from '../../../../utils/repos'

const MAX_COMMITS = 100

/** GET /api/repos/:owner/:name/commits?ref=&limit= — commit log of one ref. */
export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  const repo = await requireRepoRead(event, owner, name)

  const query = getQuery(event)
  const ref = typeof query.ref === 'string' && query.ref ? query.ref : repo.defaultBranch
  if (!isValidRef(ref))
    throw createError({ statusCode: 400, statusMessage: 'invalid ref' })
  const limit = Math.min(Math.max(Number.parseInt(String(query.limit ?? '50')) || 50, 1), MAX_COMMITS)

  const dir = repoDiskPath(owner, name)
  const sha = await resolveCommit(dir, ref)
  if (!sha)
    throw createError({ statusCode: 404, statusMessage: 'ref not found' })

  // Identity binding (M4): the pre-receive hook records who pushed each
  // commit; the UI shows human/agent plus the delegation chain from this.
  const [commits, pushers] = await Promise.all([listCommits(dir, sha, limit), readPushLog(dir)])
  return {
    ref,
    sha,
    commits: commits.map(commit => ({ ...commit, pusher: pushers.get(commit.sha) ?? null })),
  }
})
