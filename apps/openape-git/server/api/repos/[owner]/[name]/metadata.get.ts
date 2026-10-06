import { and, eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../../../../database/drizzle'
import { repos } from '../../../../database/schema'
import { repositoryAccessPredicate } from '../../../../utils/issue-access'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const principal = await requireScopedPrincipal(event, ['repos:read', 'issues:read'])
  const audience = (useRuntimeConfig().openapeSp as { clientId: string }).clientId
  const repo = await useDb().select({ owner: repos.owner, name: repos.name, issueHomeOnly: repos.issueHomeOnly, codeSourceUrl: repos.codeSourceUrl }).from(repos).where(and(
    eq(repos.owner, getRouterParam(event, 'owner') ?? ''), eq(repos.name, getRouterParam(event, 'name') ?? ''), repositoryAccessPredicate(principal.subject, audience),
  )).get()
  if (!repo) throw createError({ statusCode: 404, statusMessage: 'Repository not found' })
  return repo
})
