import type { H3Event } from 'h3'
import type { IssueFilters } from './issues'
import { and, eq } from 'drizzle-orm'
import { createError, getHeader, getMethod, getQuery, getRequestURL, getRouterParam, setHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../database/drizzle'
import { repos } from '../database/schema'
import { repositoryAccessPredicate } from './issue-access'
import { createIssueStore } from './issues'
import { createRateLimiter } from './rate-limit'
import { renderIssueMarkdown } from './render'

const subjectLimiter = createRateLimiter(120, 60)
const ipLimiter = createRateLimiter(3000, 60)

function denyRate(event: H3Event): never {
  setHeader(event, 'retry-after', 60)
  throw createError({ statusCode: 429, statusMessage: 'Too many issue requests; retry shortly' })
}

export async function issueContext(event: H3Event, scopes: string[]) {
  setHeader(event, 'cache-control', 'private, no-store')
  const config = useRuntimeConfig()
  if (config.public.issuesEnabled !== true) throw createError({ statusCode: 404, statusMessage: 'Issue tracking is not enabled' })
  if (!ipLimiter.hit(event.node.req.socket.remoteAddress ?? 'unknown')) denyRate(event)
  const principal = await requireScopedPrincipal(event, scopes)
  const mutation = !['GET', 'HEAD'].includes(getMethod(event))
  if (mutation && principal.authentication === 'session') {
    const origin = getHeader(event, 'origin')
    if (origin !== getRequestURL(event).origin || getHeader(event, 'sec-fetch-site') === 'cross-site')
      throw createError({ statusCode: 403, statusMessage: 'Same-origin request required' })
  }
  if (mutation && !subjectLimiter.hit(principal.subject)) denyRate(event)
  const audience = (config.openapeSp as { clientId: string }).clientId
  const db = useDb()
  return { db, principal, audience, store: createIssueStore(db, audience, principal) }
}

export async function issueBody(event: H3Event, fields: string[], maxBytes = 400000): Promise<Record<string, unknown>> {
  if (getHeader(event, 'content-type')?.split(';')[0]?.trim() !== 'application/json') throw createError({ statusCode: 400, statusMessage: 'JSON body required' })
  if (Number(getHeader(event, 'content-length')) > maxBytes) throw createError({ statusCode: 413, statusMessage: 'Request body is too large' })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes) {
      event.node.req.resume()
      throw createError({ statusCode: 413, statusMessage: 'Request body is too large' })
    }
    chunks.push(bytes)
  }
  let body: unknown
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' }) }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) throw createError({ statusCode: 400, statusMessage: 'Unknown or invalid request fields' })
  return body as Record<string, unknown>
}

export function issueText(value: unknown, name: string, maxLength = 65536): string {
  if (typeof value !== 'string' || value.length > maxLength) throw createError({ statusCode: 400, statusMessage: `Invalid ${name}` })
  return value
}

export function issueVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw createError({ statusCode: 400, statusMessage: 'A positive expectedVersion is required' })
  return value
}

export async function issueRepository(event: H3Event, context: Awaited<ReturnType<typeof issueContext>>, level: 'read' | 'write' | 'admin' = 'read') {
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  const repo = await context.db.select().from(repos).where(and(eq(repos.owner, owner), eq(repos.name, name), repositoryAccessPredicate(context.principal.subject, context.audience))).get()
  if (!repo) throw createError({ statusCode: 404, statusMessage: 'Repository not found' })
  if (!await context.store.repoAccess(context.db, repo.id, level)) throw createError({ statusCode: 403, statusMessage: 'Repository permission required' })
  return repo
}

export async function issueIdentity(event: H3Event, context: Awaited<ReturnType<typeof issueContext>>) {
  const id = getRouterParam(event, 'id')
  if (id) return id
  const value = getRouterParam(event, 'number') ?? ''
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw createError({ statusCode: 400, statusMessage: 'Invalid issue number' })
  return context.store.resolve(getRouterParam(event, 'owner') ?? '', getRouterParam(event, 'name') ?? '', Number(value))
}

export function issueFilters(event: H3Event): IssueFilters {
  const query = getQuery(event)
  const allowed = ['q', 'repo', 'product', 'state', 'label', 'assignee', 'reporter', 'limit', 'cursor']
  if (Object.keys(query).some(key => !allowed.includes(key))) throw createError({ statusCode: 400, statusMessage: 'Unknown issue filter' })
  const text = (key: string) => query[key] === undefined ? undefined : issueText(query[key], key, key === 'cursor' ? 1024 : 200)
  const state = text('state') ?? 'open'
  if (!['open', 'closed', 'all'].includes(state)) throw createError({ statusCode: 400, statusMessage: 'Invalid issue state' })
  const labels = query.label === undefined ? [] : Array.isArray(query.label) ? query.label : [query.label]
  return { q: text('q'), repo: text('repo'), product: text('product'), state: state as IssueFilters['state'], labels: labels.map(label => issueText(label, 'label', 100)), assignee: text('assignee'), reporter: text('reporter'), limit: query.limit === undefined ? 30 : Number(text('limit')), cursor: text('cursor') }
}

export async function issueView(context: Awaited<ReturnType<typeof issueContext>>, id: string) {
  const issue = await context.store.get(id)
  return { ...issue, bodyHtml: renderIssueMarkdown(issue.body) }
}
