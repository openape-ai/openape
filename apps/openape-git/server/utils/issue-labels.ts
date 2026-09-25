import type { H3Event } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import { createError, getRouterParam, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { grants, issueLabels, repos } from '../database/schema'
import { repositoryAccessPredicate } from './issue-access'
import { issueBody, issueContext, issueRepository, issueText, issueVersion } from './issue-api'
import { issueTransaction } from './issues'

export async function listIssueLabels(event: H3Event) {
  const context = await issueContext(event, ['issues:read'])
  const repo = await issueRepository(event, context)
  return { labels: await context.db.select().from(issueLabels).where(eq(issueLabels.repoId, repo.id)).orderBy(issueLabels.name) }
}

function labelInput(input: Record<string, unknown>) {
  const name = issueText(input.name, 'label name', 50).trim()
  const color = issueText(input.color, 'label color', 7)
  if (!name || !/^#[0-9a-f]{6}$/i.test(color)) throw createError({ statusCode: 400, statusMessage: 'Label needs a name and a six-digit hex color' })
  const description = input.description === undefined ? '' : issueText(input.description, 'description', 1000)
  if (input.archived !== undefined && typeof input.archived !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Archived must be boolean' })
  return { name, color, description, archived: input.archived ? 1 : 0 }
}

export async function saveIssueLabel(event: H3Event) {
  const context = await issueContext(event, ['issues:admin'])
  const repo = await issueRepository(event, context, 'admin')
  const id = getRouterParam(event, 'labelId')
  const input = await issueBody(event, id ? ['name', 'color', 'description', 'archived', 'expectedVersion'] : ['name', 'color', 'description'], 4096)
  const result = await issueTransaction(context.db, async (tx) => {
    if (!await context.store.repoAccess(tx, repo.id, 'admin')) throw createError({ statusCode: 403, statusMessage: 'Repository admin permission required' })
    const existing = id ? await tx.select().from(issueLabels).where(and(eq(issueLabels.id, id), eq(issueLabels.repoId, repo.id))).get() : null
    if (id && !existing) throw createError({ statusCode: 404, statusMessage: 'Label not found' })
    const values = labelInput(existing ? { ...existing, archived: Boolean(existing.archived), ...input } : input)
    const duplicate = await tx.select().from(issueLabels).where(and(eq(issueLabels.repoId, repo.id), eq(issueLabels.name, values.name))).get()
    if (duplicate && duplicate.id !== id) throw createError({ statusCode: 409, statusMessage: 'Label name already exists' })
    if (!id) return tx.insert(issueLabels).values({ id: ulid(), repoId: repo.id, ...values, version: 1 }).returning().get()
    if (issueVersion(input.expectedVersion) !== existing!.version) throw createError({ statusCode: 409, statusMessage: 'Label changed; reload before editing', data: { currentVersion: existing!.version } })
    return tx.update(issueLabels).set({ ...values, version: existing!.version + 1 }).where(eq(issueLabels.id, id)).returning().get()
  })
  if (!id) setResponseStatus(event, 201)
  return result
}

export async function listIssueAssignees(event: H3Event) {
  const context = await issueContext(event, ['issues:triage'])
  const repo = await issueRepository(event, context, 'write')
  const candidates = await context.db.select({ subject: sql<string>`json_extract(${grants.request}, '$.delegate')` }).from(grants).where(and(eq(grants.type, 'delegation'), eq(grants.status, 'approved'), sql`EXISTS (SELECT 1 FROM json_each(${grants.request}, '$.scopes') WHERE value = ${`repo:${repo.owner}/${repo.name}`})`))
  const identities = [...new Set([repo.ownerEmail, ...candidates.map(row => row.subject).filter(Boolean)])]
  const eligible = await Promise.all(identities.map(async (subject) => {
    const allowed = await context.db.select({ id: repos.id }).from(repos).where(and(eq(repos.id, repo.id), repositoryAccessPredicate(subject, context.audience))).get()
    return allowed ? subject : null
  }))
  return { assignees: eligible.filter((subject): subject is string => subject !== null).sort() }
}
