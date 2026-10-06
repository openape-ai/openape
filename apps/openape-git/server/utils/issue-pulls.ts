import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { createError, getRouterParam } from 'h3'
import { issuePullLinks, pulls, repos, issues  } from '../database/schema'
import { readableIssuePredicate, repositoryAccessPredicate } from './issue-access'
import { issueBody, issueContext, issueIdentity, issueRepository, issueText, issueVersion } from './issue-api'
import { issueTransaction } from './issues'

export async function listIssuePulls(event: H3Event) {
  const context = await issueContext(event, ['issues:read'])
  const id = await issueIdentity(event, context)
  await context.store.requireIssue(context.db, id)
  const rows = await context.db.select({ id: pulls.id, number: pulls.number, title: pulls.title, state: pulls.state, owner: repos.owner, name: repos.name }).from(issuePullLinks).innerJoin(pulls, eq(pulls.id, issuePullLinks.pullId)).innerJoin(repos, eq(repos.id, pulls.repoId)).where(and(eq(issuePullLinks.issueId, id), repositoryAccessPredicate(context.principal.subject, context.audience)))
  return { pulls: rows.map(pull => ({ ...pull, relation: 'Related', url: `/${pull.owner}/${pull.name}/pulls/${pull.number}` })) }
}

export async function listPullIssues(event: H3Event) {
  const context = await issueContext(event, ['issues:read'])
  const repo = await issueRepository(event, context)
  const number = Number(getRouterParam(event, 'number'))
  if (!Number.isSafeInteger(number) || number < 1) throw createError({ statusCode: 400, statusMessage: 'Invalid pull request number' })
  const pull = await context.db.select().from(pulls).where(and(eq(pulls.repoId, repo.id), eq(pulls.number, number))).get()
  if (!pull) throw createError({ statusCode: 404, statusMessage: 'Pull request not found' })
  const rows = await context.db.select({ id: issues.id }).from(issuePullLinks).innerJoin(issues, eq(issues.id, issuePullLinks.issueId)).where(and(eq(issuePullLinks.pullId, pull.id), readableIssuePredicate(context.principal, context.audience)))
  const visible = await Promise.all(rows.map(async ({ id }) => {
    const issue = await context.store.get(id)
    return { id, title: issue.title, number: issue.number, state: issue.state, relation: 'Related', url: issue.repositoryUrl ?? issue.stableUrl }
  }))
  return { issues: visible }
}

export async function linkIssuePull(event: H3Event) {
  const context = await issueContext(event, ['issues:triage'])
  const id = await issueIdentity(event, context)
  const input = await issueBody(event, ['repository', 'number'], 1024)
  const repository = issueText(input.repository, 'pull repository', 200)
  if (!/^[\w-]+\/[\w.-]+$/.test(repository)) throw createError({ statusCode: 400, statusMessage: 'Use owner/name for the pull repository' })
  const [owner, name] = repository.split('/')
  const number = issueVersion(input.number)
  await issueTransaction(context.db, async (tx) => {
    const issue = await context.store.requireIssue(tx, id)
    if (!(await context.store.capabilities(tx, issue)).triage) throw createError({ statusCode: 403, statusMessage: 'Issue triage permission required' })
    const repo = await tx.select().from(repos).where(and(eq(repos.owner, owner!), eq(repos.name, name!), repositoryAccessPredicate(context.principal.subject, context.audience, 'write'))).get()
    const pull = repo ? await tx.select().from(pulls).where(and(eq(pulls.repoId, repo.id), eq(pulls.number, number))).get() : null
    if (!pull) throw createError({ statusCode: 404, statusMessage: 'Pull request not found' })
    const existing = await tx.select().from(issuePullLinks).where(and(eq(issuePullLinks.issueId, id), eq(issuePullLinks.pullId, pull.id))).get()
    if (existing) return
    await tx.insert(issuePullLinks).values({ issueId: id, pullId: pull.id, subject: context.principal.subject, actor: context.principal.actor, createdAt: Date.now() })
    await context.store.event(tx, id, 'pull-linked', { pullId: pull.id })
  })
  return { ok: true }
}

export async function unlinkIssuePull(event: H3Event) {
  const context = await issueContext(event, ['issues:triage'])
  const id = await issueIdentity(event, context)
  const pullId = getRouterParam(event, 'pullId') ?? ''
  await issueTransaction(context.db, async (tx) => {
    const issue = await context.store.requireIssue(tx, id)
    if (!(await context.store.capabilities(tx, issue)).triage) throw createError({ statusCode: 403, statusMessage: 'Issue triage permission required' })
    const pull = await tx.select().from(pulls).where(eq(pulls.id, pullId)).get()
    if (!pull || !await context.store.repoAccess(tx, pull.repoId, 'write')) throw createError({ statusCode: 404, statusMessage: 'Pull request not found' })
    const deleted = await tx.delete(issuePullLinks).where(and(eq(issuePullLinks.issueId, id), eq(issuePullLinks.pullId, pullId))).returning()
    if (deleted.length) await context.store.event(tx, id, 'pull-unlinked', { pullId })
  })
  return { ok: true }
}
