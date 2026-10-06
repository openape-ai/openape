import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { createError, getHeader, getQuery, getRouterParam, setResponseStatus } from 'h3'
import { issueComments, issueEvents, issues } from '../database/schema'
import { principalAllows } from './issue-access'
import { issueBody, issueContext, issueFilters, issueIdentity, issueRepository, issueText, issueVersion, issueView } from './issue-api'
import { issueTransaction, validateCommentText } from './issues'
import { renderIssueMarkdown } from './render'
import { attachmentList, importedAttribution, importedText } from './issue-imports'

export async function listIssues(event: H3Event) {
  const context = await issueContext(event, ['issues:read'])
  const filters = issueFilters(event)
  if (getRouterParam(event, 'owner')) {
    const repo = await issueRepository(event, context)
    filters.repo = `${repo.owner}/${repo.name}`
  }
  const page = await context.store.list(filters)
  const issues = await Promise.all(page.ids.map(async (id) => {
    const { body: _body, ...issue } = await context.store.get(id)
    return { ...issue, imported: await importedAttribution(context, id) }
  }))
  return { issues, total: page.total, cursor: page.cursor }
}

export async function getIssue(event: H3Event) {
  const context = await issueContext(event, ['issues:read'])
  const id = await issueIdentity(event, context)
  const issue = await issueView(context, id)
  const events = await context.db.select({ id: issueEvents.id, action: issueEvents.action, actor: issueEvents.actor, subject: issueEvents.subject, createdAt: issueEvents.createdAt }).from(issueEvents).where(eq(issueEvents.issueId, id)).orderBy(issueEvents.createdAt, issueEvents.id).limit(100)
  return { ...issue, events, attachments: await attachmentList(context, id) }
}

export async function createIssue(event: H3Event) {
  const context = await issueContext(event, ['issues:create'])
  const repo = await issueRepository(event, context)
  const input = await issueBody(event, ['title', 'body'])
  const id = await context.store.create(repo.id, { title: issueText(input.title, 'title', 200), body: input.body === undefined ? '' : issueText(input.body, 'body', 400000) }, getHeader(event, 'idempotency-key') ?? '')
  setResponseStatus(event, 201)
  return issueView(context, id)
}

export async function updateIssue(event: H3Event) {
  const context = await issueContext(event, ['issues:edit-own', 'issues:triage'])
  const id = await issueIdentity(event, context)
  const input = await issueBody(event, ['title', 'body', 'state', 'assignee', 'labels', 'expectedVersion'])
  const update: Parameters<typeof context.store.update>[1] = { expectedVersion: issueVersion(input.expectedVersion) }
  if ('title' in input) update.title = issueText(input.title, 'title', 200)
  if ('body' in input) update.body = issueText(input.body, 'body', 400000)
  if ('state' in input) {
    if (input.state !== 'open' && input.state !== 'closed') throw createError({ statusCode: 400, statusMessage: 'Invalid issue state' })
    update.state = input.state
  }
  if ('assignee' in input) update.assignee = input.assignee === null ? null : issueText(input.assignee, 'assignee', 255)
  if ('labels' in input) {
    if (!Array.isArray(input.labels)) throw createError({ statusCode: 400, statusMessage: 'Labels must be an array' })
    update.labels = input.labels.map(label => issueText(label, 'label', 100))
  }
  await context.store.update(id, update)
  return issueView(context, id)
}

export async function listIssueComments(event: H3Event) {
  const context = await issueContext(event, ['issues:read'])
  const id = await issueIdentity(event, context)
  const query = getQuery(event)
  if (Object.keys(query).some(key => !['after', 'limit'].includes(key))) throw createError({ statusCode: 400, statusMessage: 'Unknown comment filter' })
  const after = query.after === undefined ? '' : issueText(query.after, 'comment cursor', 100)
  const limit = query.limit === undefined ? 30 : Number(issueText(query.limit, 'limit', 3))
  const comments = await context.store.comments(id, after, limit)
  return { comments: await Promise.all(comments.map(async comment => ({ ...comment, canEdit: comment.authorSubject === context.principal.subject && principalAllows(context.principal, 'issues:edit-own'), ...await importedText(context, comment.id, comment.body) }))), next: comments.length === limit ? comments.at(-1)!.id : null }
}

export async function createIssueComment(event: H3Event) {
  const context = await issueContext(event, ['issues:comment'])
  const id = await issueIdentity(event, context)
  const input = await issueBody(event, ['body'], 200000)
  const commentId = await context.store.comment(id, issueText(input.body, 'body', 400000), getHeader(event, 'idempotency-key') ?? '')
  setResponseStatus(event, 201)
  return { id: commentId, issueId: id, version: 1, anchor: `#comment-${commentId}` }
}

export async function updateIssueComment(event: H3Event) {
  const context = await issueContext(event, ['issues:edit-own', 'issues:admin'])
  const id = await issueIdentity(event, context)
  const commentId = getRouterParam(event, 'commentId') ?? ''
  const input = await issueBody(event, ['body', 'expectedVersion', 'reason'], 200000)
  const expectedVersion = issueVersion(input.expectedVersion)
  const body = validateCommentText(issueText(input.body, 'body', 400000))
  if (!body.trim()) throw createError({ statusCode: 400, statusMessage: 'Comment must not be empty' })
  await issueTransaction(context.db, async (tx) => {
    const issue = await context.store.requireIssue(tx, id)
    const comment = await tx.select().from(issueComments).where(and(eq(issueComments.id, commentId), eq(issueComments.issueId, id), eq(issueComments.hidden, 0))).get()
    if (!comment) throw createError({ statusCode: 404, statusMessage: 'Comment not found' })
    const own = comment.authorSubject === context.principal.subject && principalAllows(context.principal, 'issues:edit-own')
    const admin = (await context.store.capabilities(tx, issue)).admin
    if (!own && !admin) throw createError({ statusCode: 403, statusMessage: 'Only the author may edit this comment' })
    const reason = own ? undefined : issueText(input.reason, 'redaction reason', 1000)
    if (!own && !reason?.trim()) throw createError({ statusCode: 400, statusMessage: 'Redaction reason is required' })
    if (comment.version !== expectedVersion) throw createError({ statusCode: 409, statusMessage: 'Comment changed; reload before editing', data: { currentVersion: comment.version } })
    await tx.update(issueComments).set({ body, version: comment.version + 1, updatedAt: Date.now() }).where(eq(issueComments.id, commentId))
    await tx.update(issues).set({ updatedAt: Date.now() }).where(eq(issues.id, id))
    await context.store.event(tx, id, own ? 'comment-edited' : 'comment-redacted', { commentId, reason })
  })
  return { id: commentId, version: expectedVersion + 1, body, bodyHtml: renderIssueMarkdown(body) }
}
