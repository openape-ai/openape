import { spawn } from 'node:child_process'
import { createError, defineEventHandler, getHeader, getQuery, getRouterParam, sendStream, setHeader } from 'h3'
import { isValidSha } from '../../../../utils/git-parse'
import { repoDiskPath } from '../../../../utils/repos'
import { repoBySignedRequest } from '../../../../utils/webhook-auth'
import { archivePayload, isFreshTimestamp, TIMESTAMP_HEADER } from '../../../../utils/webhooks'

/**
 * GET /api/repos/:owner/:name/archive?sha= — the pushed tree as tar.gz, for a
 * webhook consumer that wants to build it. Signed with the webhook secret over
 * `<repo>\n<sha>\n<timestamp>` (a GET has no body to sign), so a CI runner
 * needs neither a git credential nor a mount of the repo storage.
 */
export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  const sha = String(getQuery(event).sha ?? '')
  if (!isValidSha(sha))
    throw createError({ statusCode: 400, statusMessage: 'sha must be a full commit sha' })

  const timestamp = getHeader(event, TIMESTAMP_HEADER)
  if (!isFreshTimestamp(timestamp, Math.floor(Date.now() / 1000)))
    throw createError({ statusCode: 401, statusMessage: 'stale or missing timestamp' })

  await repoBySignedRequest(event, owner, name, archivePayload(owner, name, sha, timestamp!))

  const archive = spawn('git', ['-C', repoDiskPath(owner, name), 'archive', '--format=tar.gz', sha])
  archive.stderr.on('data', (data: Buffer) => console.error('[git archive]', data.toString().trim()))
  setHeader(event, 'content-type', 'application/gzip')
  setHeader(event, 'cache-control', 'no-store')
  return sendStream(event, archive.stdout)
})
