import type { H3Event } from 'h3'
import { resolve } from 'node:path'
import { defineEventHandler, getHeader, getQuery } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { accessAllows, accessFromGrants, capAccess, parseGitHttpPath, requiredAccessFor } from '../utils/git-access'
import { identityFromBasicAuth } from '../utils/git-auth'
import { runGitHttpBackend } from '../utils/git-cgi'
import { useGrantStore } from '../utils/grant-store'
import { internalToken, pushEventUrl } from '../utils/internal-token'
import { createRateLimiter } from '../utils/rate-limit'
import { findRepo, reposRoot } from '../utils/repos'

// Grant-gated git smart HTTP: /<owner>/<name>.git/* → rate limit → DDISA-JWT
// auth → registry lookup → grant check → `git http-backend` CGI. Lives in
// middleware (not a route) so the raw node req/res can stream packfiles
// untouched. Error bodies stay ASCII-only: git prints them raw on the client
// (M0 lesson). The verified identity rides down to the pre-receive hook via
// APE_GIT_* env (M4 identity binding).

function deny(event: H3Event, status: number, message: string): void {
  const res = event.node.res
  const headers: Record<string, string> = { 'Content-Type': 'text/plain' }
  // Without the challenge git never sends the credentials from the URL.
  if (status === 401) headers['WWW-Authenticate'] = 'Basic realm="ape-git"'
  res.writeHead(status, headers)
  res.end(`${message}\n`)
}

let _limiter: ReturnType<typeof createRateLimiter> | null = null

function limiter() {
  if (!_limiter) {
    const config = useRuntimeConfig()
    _limiter = createRateLimiter(
      Number(config.gitRateLimit) || 240,
      Number(config.gitRateWindowSec) || 60,
    )
  }
  return _limiter
}

/** Client IP: first X-Forwarded-For hop (Caddy sits in front), else socket. */
function clientIp(event: H3Event): string {
  const forwarded = getHeader(event, 'x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || event.node.req.socket.remoteAddress || 'unknown'
}

export default defineEventHandler(async (event) => {
  const pathname = event.path.split('?')[0] ?? ''
  const parsed = parseGitHttpPath(pathname)
  if (!parsed) return

  // Per-IP and pre-auth, so token verification itself is behind the limit.
  if (!limiter().hit(clientIp(event)))
    return deny(event, 429, 'ape-git: rate limit exceeded - retry later')

  const identity = await identityFromBasicAuth(getHeader(event, 'authorization'))
  if (!identity) return deny(event, 401, 'ape-git: valid DDISA token required')

  // Resolve against the registry — the URL is never used as a filesystem path.
  const repo = await findRepo(parsed.owner, parsed.name)
  if (!repo) return deny(event, 404, `ape-git: no such repo ${parsed.owner}/${parsed.name}`)

  const config = useRuntimeConfig()
  const clientId = (config.openapeSp as { clientId?: string })?.clientId ?? 'repos.openape.ai'
  const service = (getQuery(event).service as string | undefined) ?? pathname.split('/').pop() ?? null
  const required = requiredAccessFor(pathname, service)

  const email = identity.email
  let access = repo.ownerEmail === email
    ? 'admin' as const
    : accessFromGrants(await useGrantStore().findByDelegate(email), email, parsed.owner, parsed.name, clientId)
  // A scoped (delegated) token caps access at its own git:* scopes.
  if (access && identity.cap !== undefined)
    access = identity.cap === 'none' ? null : capAccess(access, identity.cap)
  if (!access) return deny(event, 403, `ape-git: no grant for ${email} on ${parsed.owner}/${parsed.name}`)
  if (!accessAllows(access, required))
    return deny(event, 403, `ape-git: grant for ${email} on ${parsed.owner}/${parsed.name} is git:${access} - ${service ?? 'push'} denied`)

  await runGitHttpBackend(event.node.req, event.node.res, {
    projectRoot: reposRoot(),
    pathInfo: pathname,
    queryString: event.path.includes('?') ? event.path.slice(event.path.indexOf('?') + 1) : '',
    remoteUser: email,
    env: {
      // Identity for the pre-receive hook (inherited via receive-pack).
      APE_GIT_AUTH_EMAIL: email,
      APE_GIT_AUTH_ACT: identity.act,
      APE_GIT_DELEGATOR: identity.delegator ?? '',
      APE_GIT_ACCESS: access,
      // Webhook firing (M5): post-receive reports back over loopback.
      APE_GIT_REPO_OWNER: parsed.owner,
      APE_GIT_REPO_NAME: parsed.name,
      APE_GIT_EVENT_URL: pushEventUrl(),
      APE_GIT_INTERNAL_TOKEN: internalToken(),
      // Central hooks dir — every repo gets the current hook, no migration.
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: resolve(config.gitDataDir as string, 'hooks'),
    },
  })
})
