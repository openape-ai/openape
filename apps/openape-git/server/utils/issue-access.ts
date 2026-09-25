import type { SQL } from 'drizzle-orm'
import type { GitAccess } from './git-access'
import { sql } from 'drizzle-orm'
import { issues, repos } from '../database/schema'

export interface IssuePrincipal {
  subject: string
  actor: string
  scope?: string[]
}

export function repositoryAccessPredicate(subject: string, audience: string, required: GitAccess = 'read'): SQL {
  const levels = required === 'admin' ? ['git:admin'] : required === 'write' ? ['git:admin', 'git:write'] : ['git:admin', 'git:write', 'git:read']
  return sql`(${repos.ownerEmail} = ${subject} OR EXISTS (
    SELECT 1 FROM grants g WHERE g.type = 'delegation' AND g.status = 'approved'
    AND json_extract(g.request, '$.delegate') = ${subject}
    AND json_extract(g.request, '$.audience') = ${audience}
    AND NOT (COALESCE(json_extract(g.request, '$.grant_type'), '') = 'timed' AND COALESCE(g.expires_at, 0) != 0 AND g.expires_at <= ${Math.floor(Date.now() / 1000)})
    AND EXISTS (SELECT 1 FROM json_each(g.request, '$.scopes') WHERE value = 'repo:' || ${repos.owner} || '/' || ${repos.name})
    AND EXISTS (SELECT 1 FROM json_each(g.request, '$.scopes') WHERE value IN (${sql.join(levels.map(level => sql`${level}`), sql`, `)}))
  ))`
}

export function issueRepoAccessPredicate(principal: IssuePrincipal, audience: string, required: GitAccess = 'read'): SQL {
  return sql`EXISTS (SELECT 1 FROM ${repos} WHERE ${repos.id} = ${issues.repoId} AND ${repositoryAccessPredicate(principal.subject, audience, required)})`
}

export function readableIssuePredicate(principal: IssuePrincipal, audience: string): SQL {
  const repository = issueRepoAccessPredicate(principal, audience)
  const participant = sql`EXISTS (SELECT 1 FROM issue_participants p WHERE p.issue_id = ${issues.id} AND p.subject = ${principal.subject})`
  return sql`((${issues.hidden} = 0 AND (${repository} OR ${participant})) OR ${issueRepoAccessPredicate(principal, audience, 'admin')})`
}

export function principalAllows(principal: IssuePrincipal, scope: string): boolean {
  return principal.scope === undefined || principal.scope.includes(scope)
}
