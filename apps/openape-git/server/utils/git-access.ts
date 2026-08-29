import type { OpenApeGrant } from '@openape/core'
import { isGrantExpired } from '@openape/grants'

// Pure authorization logic for the git smart-HTTP transport. A repo grant is a
// delegation grant whose scopes carry the access level (`git:read|write|admin`)
// and the resource (`repo:<owner>/<name>`) — see the ape-git plan, M1.

export type GitAccess = 'read' | 'write' | 'admin'

const ACCESS_RANK: Record<GitAccess, number> = { read: 1, write: 2, admin: 3 }

// Owners sit at the root of the URL space (`/<owner>/<repo>`), so a name that
// matches a top-level route would shadow it for everyone. `_nuxt` and
// `.well-known` need no entry — the pattern below already rejects a leading
// underscore and any dot. tests/reserved-owners.test.ts derives the required
// set from the pages directory, so a new top-level page fails there.
const RESERVED_OWNERS = new Set(['api'])

export function isValidOwner(value: string): boolean {
  if (RESERVED_OWNERS.has(value.toLowerCase())) return false
  return /^[a-z0-9][a-z0-9-]{0,63}$/i.test(value)
}

export function isValidRepoName(value: string): boolean {
  if (value.includes('..') || value.toLowerCase().endsWith('.git')) return false
  return /^\w[\w.-]{0,99}$/.test(value)
}

export function repoScope(owner: string, name: string): string {
  return `repo:${owner}/${name}`
}

/** `/<owner>/<name>.git/<rest>` → parts, or null when the path is no git URL. */
export function parseGitHttpPath(pathname: string): { owner: string, name: string, rest: string } | null {
  const match = pathname.match(/^\/([^/]+)\/([^/]+)\.git(\/.*)?$/)
  if (!match) return null
  const [, owner, name, rest] = match
  if (!isValidOwner(owner!) || !isValidRepoName(name!)) return null
  return { owner: owner!, name: name!, rest: rest ?? '' }
}

/** The lower of two access levels — a scoped token caps the granted access. */
export function capAccess(access: GitAccess, cap: GitAccess): GitAccess {
  return ACCESS_RANK[cap] < ACCESS_RANK[access] ? cap : access
}

/** receive-pack (push) needs write; everything else (clone/fetch) needs read. */
export function requiredAccess(service: string | null): GitAccess {
  return service === 'git-receive-pack' ? 'write' : 'read'
}

// `git http-backend` dispatches POSTs via PATH_INFO and never reads `?service=`,
// so deriving the level from the query parameter alone is fail-open.
export function requiredAccessFor(pathname: string, serviceParam: string | null): GitAccess {
  if (pathname.endsWith('/git-receive-pack')) return 'write'
  return requiredAccess(serviceParam)
}

export function accessAllows(access: GitAccess, required: GitAccess): boolean {
  return ACCESS_RANK[access] >= ACCESS_RANK[required]
}

/** Access level a scope list gives on one repo, or null when it names another repo. */
export function accessFromScopes(scopes: string[] | undefined, owner: string, name: string): GitAccess | null {
  if (!scopes?.includes(repoScope(owner, name))) return null
  let best: GitAccess | null = null
  for (const scope of scopes) {
    if (scope !== 'git:read' && scope !== 'git:write' && scope !== 'git:admin') continue
    const access = scope.slice('git:'.length) as GitAccess
    if (!best || ACCESS_RANK[access] > ACCESS_RANK[best]) best = access
  }
  return best
}

/**
 * Best access the delegate's grants give on the repo. Only approved,
 * unexpired delegation grants for this SP count — a revoked grant is a
 * plain 403 on the very next request.
 */
export function accessFromGrants(
  delegateGrants: OpenApeGrant[],
  email: string,
  owner: string,
  name: string,
  audience: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): GitAccess | null {
  let best: GitAccess | null = null
  for (const grant of delegateGrants) {
    if (grant.status !== 'approved' || isGrantExpired(grant, nowSec)) continue
    if (grant.request.delegate !== email || grant.request.audience !== audience) continue
    const access = accessFromScopes(grant.request.scopes, owner, name)
    if (access && (!best || ACCESS_RANK[access] > ACCESS_RANK[best])) best = access
  }
  return best
}
