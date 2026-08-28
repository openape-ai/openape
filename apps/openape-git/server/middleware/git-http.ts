import type { H3Event } from 'h3'
import { defineEventHandler, getHeader, getQuery } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { accessAllows, accessFromGrants, parseGitHttpPath, requiredAccess } from '../utils/git-access'
import { emailFromBasicAuth } from '../utils/git-auth'
import { runGitHttpBackend } from '../utils/git-cgi'
import { useGrantStore } from '../utils/grant-store'
import { findRepo, reposRoot } from '../utils/repos'

// Grant-gated git smart HTTP: /<owner>/<name>.git/* → DDISA-JWT auth →
// registry lookup → grant check → `git http-backend` CGI. Lives in middleware
// (not a route) so the raw node req/res can stream packfiles untouched.
// Error bodies stay ASCII-only: git prints them raw on the client (M0 lesson).

function deny(event: H3Event, status: number, message: string): void {
  const res = event.node.res
  const headers: Record<string, string> = { 'Content-Type': 'text/plain' }
  // Without the challenge git never sends the credentials from the URL.
  if (status === 401) headers['WWW-Authenticate'] = 'Basic realm="ape-git"'
  res.writeHead(status, headers)
  res.end(`${message}\n`)
}

export default defineEventHandler(async (event) => {
  const pathname = event.path.split('?')[0] ?? ''
  const parsed = parseGitHttpPath(pathname)
  if (!parsed) return

  const email = await emailFromBasicAuth(getHeader(event, 'authorization'))
  if (!email) return deny(event, 401, 'ape-git: valid DDISA token required')

  // Resolve against the registry — the URL is never used as a filesystem path.
  const repo = await findRepo(parsed.owner, parsed.name)
  if (!repo) return deny(event, 404, `ape-git: no such repo ${parsed.owner}/${parsed.name}`)

  const config = useRuntimeConfig()
  const clientId = (config.openapeSp as { clientId?: string })?.clientId ?? 'repos.openape.ai'
  const service = (getQuery(event).service as string | undefined) ?? pathname.split('/').pop() ?? null
  const required = requiredAccess(service)

  const access = repo.ownerEmail === email
    ? 'admin' as const
    : accessFromGrants(await useGrantStore().findByDelegate(email), email, parsed.owner, parsed.name, clientId)
  if (!access) return deny(event, 403, `ape-git: no grant for ${email} on ${parsed.owner}/${parsed.name}`)
  if (!accessAllows(access, required))
    return deny(event, 403, `ape-git: grant for ${email} on ${parsed.owner}/${parsed.name} is git:${access} - ${service ?? 'push'} denied`)

  await runGitHttpBackend(event.node.req, event.node.res, {
    projectRoot: reposRoot(),
    pathInfo: pathname,
    queryString: event.path.includes('?') ? event.path.slice(event.path.indexOf('?') + 1) : '',
    remoteUser: email,
  })
})
