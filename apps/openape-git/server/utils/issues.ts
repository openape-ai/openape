import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { IssuePrincipal } from './issue-access'
import type * as schema from '../database/schema'
import { createHash } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { ulid } from 'ulid'
import { issueAliases, issueComments, issueCounters, issueImportTargets, issueEvents, issueLabelLinks, issueLabels, issueParticipants, issues, issueWriteRequests, products, repos } from '../database/schema'
import { principalAllows, readableIssuePredicate, repositoryAccessPredicate } from './issue-access'

type Database = LibSQLDatabase<typeof schema>
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type Store = Database | Transaction
export type Issue = typeof issues.$inferSelect
export type IssueComment = typeof issueComments.$inferSelect
export interface IssueInput { title: string, body: string }
export interface IssueFilters {
  q?: string
  repo?: string
  product?: string
  state?: 'open' | 'closed' | 'all'
  labels?: string[]
  assignee?: string
  reporter?: string
  triage?: 'classified' | 'unclassified'
  limit?: number
  cursor?: string
}

function failure(statusCode: number, statusMessage: string): never {
  throw createError({ statusCode, statusMessage })
}

export function validateIssueText(input: IssueInput): IssueInput {
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200) failure(400, 'Title must contain 1–200 characters')
  validateCommentText(input.body, 65536)
  return { title: input.title.trim(), body: input.body }
}

export function validateCommentText(body: string, max = 32768): string {
  if (typeof body !== 'string') failure(400, 'Markdown body must be text')
  if (Buffer.byteLength(body, 'utf8') > max) failure(413, 'Markdown body is too large')
  return body
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function writeOnce<T>(tx: Transaction, principal: IssuePrincipal, operation: string, key: string, input: unknown, action: () => Promise<T>): Promise<T> {
  if (!/^[\w.-]{8,128}$/.test(key)) failure(400, 'Idempotency-Key must contain 8–128 letters, digits, dots, dashes or underscores')
  const where = and(eq(issueWriteRequests.subject, principal.subject), eq(issueWriteRequests.actor, principal.actor), eq(issueWriteRequests.operation, operation), eq(issueWriteRequests.requestKey, key))
  const hash = fingerprint(input)
  const previous = await tx.select().from(issueWriteRequests).where(where).get()
  if (previous) {
    if (previous.payloadHash !== hash) failure(409, 'Idempotency key was used with different content')
    return JSON.parse(previous.result) as T
  }
  const result = await action()
  await tx.insert(issueWriteRequests).values({ subject: principal.subject, actor: principal.actor, operation, requestKey: key, payloadHash: hash, result: JSON.stringify(result), createdAt: Date.now() })
  return result
}

export async function nextNumber(tx: Transaction, repoId: string): Promise<number> {
  await tx.insert(issueCounters).values({ repoId, nextNumber: 1 }).onConflictDoNothing()
  const row = await tx.update(issueCounters).set({ nextNumber: sql`${issueCounters.nextNumber} + 1` }).where(eq(issueCounters.repoId, repoId)).returning().get()
  return row!.nextNumber - 1
}

const pendingWrites = new WeakMap<Database, Promise<void>>()

export async function issueTransaction<T>(db: Database, action: (tx: Transaction) => Promise<T>): Promise<T> {
  const previous = pendingWrites.get(db)
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  pendingWrites.set(db, pending)
  await previous
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.transaction(action, { behavior: 'immediate' })
      }
      catch (error) {
        const cause = (error as { cause?: Error }).cause
        if (String(error).includes('ISSUE_IMPORT_LOCKED') || String(cause).includes('ISSUE_IMPORT_LOCKED')) failure(503, 'Issue migration is awaiting cutover; writes are disabled')
        const code = (error as { code?: string, cause?: { code?: string } }).code
          ?? (error as { cause?: { code?: string } }).cause?.code
        if (code !== 'SQLITE_BUSY' || attempt >= 7) throw error
        await setTimeout(Math.min(10 * 2 ** attempt, 200))
      }
    }
  }
  finally {
    release()
    if (pendingWrites.get(db) === pending) pendingWrites.delete(db)
  }
}

export function createIssueStore(db: Database, audience: string, principal: IssuePrincipal) {
  const visible = readableIssuePredicate(principal, audience)

  async function repoAccess(store: Store, repoId: string, level: 'read' | 'write' | 'admin' = 'read') {
    return store.select().from(repos).where(and(eq(repos.id, repoId), repositoryAccessPredicate(principal.subject, audience, level))).get()
  }

  async function requireIssue(store: Store, id: string) {
    const issue = await store.select().from(issues).where(and(eq(issues.id, id), visible)).get()
    if (!issue) failure(404, 'Issue not found')
    return issue
  }

  async function event(tx: Transaction, issueId: string, action: string, details: unknown = {}) {
    await tx.insert(issueEvents).values({ id: ulid(), issueId, action, subject: principal.subject, actor: principal.actor, details: JSON.stringify(details), createdAt: Date.now() })
  }

  async function capabilities(store: Store, issue: Issue) {
    const locked = await store.select().from(issueImportTargets).where(and(eq(issueImportTargets.repoId, issue.repoId), eq(issueImportTargets.status, 'locked'))).get()
    const [read, write, admin] = await Promise.all([repoAccess(store, issue.repoId), repoAccess(store, issue.repoId, 'write'), repoAccess(store, issue.repoId, 'admin')])
    return {
      migrationLocked: Boolean(locked),
      repository: read ? { owner: read.owner, name: read.name } : null,
      comment: !locked && principalAllows(principal, 'issues:comment'),
      edit: !locked && ((issue.authorSubject === principal.subject && principalAllows(principal, 'issues:edit-own')) || (Boolean(write) && principalAllows(principal, 'issues:triage'))),
      triage: !locked && Boolean(write) && principalAllows(principal, 'issues:triage'),
      admin: !locked && Boolean(admin) && principalAllows(principal, 'issues:admin'),
    }
  }

  async function createRow(tx: Transaction, repoId: string, input: IssueInput, productKey: string | null, participant: boolean) {
    const now = Date.now()
    const row = await tx.insert(issues).values({ id: ulid(), repoId, number: await nextNumber(tx, repoId), ...input, state: 'open', productKey, authorSubject: principal.subject, authorActor: principal.actor, version: 1, hidden: 0, createdAt: now, updatedAt: now }).returning().get()
    await tx.insert(issueAliases).values({ repoId, number: row!.number, issueId: row!.id })
    if (participant) await tx.insert(issueParticipants).values({ issueId: row!.id, subject: principal.subject, createdBy: principal.actor, createdAt: now })
    await event(tx, row!.id, 'created')
    return row!.id
  }

  return {
    async get(id: string) {
      const issue = await requireIssue(db, id)
      const allowed = await capabilities(db, issue)
      const labels = await db.select({ id: issueLabels.id, name: issueLabels.name, color: issueLabels.color }).from(issueLabels).innerJoin(issueLabelLinks, eq(issueLabels.id, issueLabelLinks.labelId)).where(eq(issueLabelLinks.issueId, id))
      const product = issue.productKey ? await db.select({ name: products.name }).from(products).where(eq(products.key, issue.productKey)).get() : null
      const { repoId: _repo, number, ...record } = issue
      return { ...record, number: allowed.repository ? number : null, productName: product?.name ?? (issue.triageState === 'unclassified' ? 'Unclassified' : 'No product'), labels, capabilities: allowed, stableUrl: `/i/${id}`, repositoryUrl: allowed.repository ? `/${allowed.repository.owner}/${allowed.repository.name}/issues/${number}` : null }
    },

    async resolve(owner: string, name: string, number: number) {
      const alias = await db.select({ issueId: issueAliases.issueId }).from(issueAliases).innerJoin(repos, eq(repos.id, issueAliases.repoId)).where(and(eq(repos.owner, owner), eq(repos.name, name), eq(issueAliases.number, number), repositoryAccessPredicate(principal.subject, audience))).get()
      if (!alias) failure(404, 'Issue not found')
      await requireIssue(db, alias.issueId)
      return alias.issueId
    },

    async list(filters: IssueFilters = {}) {
      const { cursor, limit = 30, ...search } = filters
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) failure(400, 'Limit must be between 1 and 100')
      if ((search.q?.length ?? 0) > 200 || (search.labels?.length ?? 0) > 20) failure(400, 'Too many search terms')
      const hash = fingerprint(search)
      const predicates = [visible]
      if (search.state !== 'all') predicates.push(eq(issues.state, search.state ?? 'open'))
      if (search.triage) predicates.push(eq(issues.triageState, search.triage))
      if (search.product) predicates.push(eq(issues.productKey, search.product))
      if (search.assignee) predicates.push(eq(issues.assignee, search.assignee === 'me' ? principal.subject : search.assignee))
      if (search.reporter) predicates.push(eq(issues.authorSubject, search.reporter === 'me' ? principal.subject : search.reporter))
      if (search.repo) predicates.push(sql`EXISTS (SELECT 1 FROM ${repos} WHERE ${repos.id} = ${issues.repoId} AND ${repos.owner} || '/' || ${repos.name} = ${search.repo} AND ${repositoryAccessPredicate(principal.subject, audience)})`)
      if (search.q) {
        const pattern = `%${search.q.replace(/[!%_]/g, '!$&')}%`
        predicates.push(sql`(${issues.title} LIKE ${pattern} ESCAPE '!' OR ${issues.body} LIKE ${pattern} ESCAPE '!')`)
      }
      for (const label of search.labels ?? []) predicates.push(sql`EXISTS (SELECT 1 FROM issue_label_links l WHERE l.issue_id = ${issues.id} AND l.label_id = ${label})`)
      const total = await db.select({ count: sql<number>`count(*)` }).from(issues).where(and(...predicates)).get()
      if (cursor) {
        let value: { hash: string, updatedAt: number, id: string }
        try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString()) }
        catch { failure(400, 'Invalid cursor') }
        if (!value! || value!.hash !== hash || !Number.isSafeInteger(value!.updatedAt) || typeof value!.id !== 'string') failure(400, 'Cursor does not match filters')
        predicates.push(sql`(${issues.updatedAt}, ${issues.id}) < (${value!.updatedAt}, ${value!.id})`)
      }
      const rows = await db.select({ id: issues.id, updatedAt: issues.updatedAt }).from(issues).where(and(...predicates)).orderBy(desc(issues.updatedAt), desc(issues.id)).limit(limit + 1)
      const page = rows.slice(0, limit)
      const last = page.at(-1)
      return { ids: page.map(row => row.id), total: total!.count, cursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ hash, ...last })).toString('base64url') : null }
    },

    async create(repoId: string, input: IssueInput, key: string) {
      const text = validateIssueText(input)
      if (!principalAllows(principal, 'issues:create')) failure(403, 'Issue creation is not permitted')
      return issueTransaction(db, async (tx) => {
        if (!await repoAccess(tx, repoId)) failure(404, 'Repository not found')
        return writeOnce(tx, principal, `create:${repoId}`, key, text, () => createRow(tx, repoId, text, null, false))
      })
    },

    async comments(id: string, after = '', limit = 30) {
      await requireIssue(db, id)
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) failure(400, 'Invalid comment limit')
      const predicates = [eq(issueComments.issueId, id), eq(issueComments.hidden, 0)]
      if (after) {
        const cursor = await db.select().from(issueComments).where(and(eq(issueComments.id, after), eq(issueComments.issueId, id))).get()
        if (!cursor) failure(400, 'Invalid comment cursor')
        predicates.push(sql`(${issueComments.createdAt}, ${issueComments.id}) > (${cursor.createdAt}, ${cursor.id})`)
      }
      return db.select().from(issueComments).where(and(...predicates)).orderBy(asc(issueComments.createdAt), asc(issueComments.id)).limit(limit)
    },

    async comment(id: string, body: string, key: string) {
      validateCommentText(body)
      if (!body.trim()) failure(400, 'Comment must not be empty')
      if (!principalAllows(principal, 'issues:comment')) failure(403, 'Commenting is not permitted')
      return issueTransaction(db, async (tx) => {
        await requireIssue(tx, id)
        return writeOnce(tx, principal, `comment:${id}`, key, { body }, async () => {
          const now = Date.now()
          const comment = await tx.insert(issueComments).values({ id: ulid(), issueId: id, body, authorSubject: principal.subject, authorActor: principal.actor, version: 1, hidden: 0, createdAt: now }).returning().get()
          await tx.update(issues).set({ updatedAt: now }).where(eq(issues.id, id))
          await event(tx, id, 'commented', { commentId: comment!.id })
          return comment!.id
        })
      })
    },

    async update(id: string, input: Partial<IssueInput> & { state?: 'open' | 'closed', assignee?: string | null, labels?: string[], expectedVersion: number }) {
      return issueTransaction(db, async (tx) => {
        const issue = await requireIssue(tx, id)
        const allowed = await capabilities(tx, issue)
        if (!allowed.edit && !allowed.triage) failure(403, 'Editing is not permitted')
        if (input.expectedVersion !== issue.version) throw createError({ statusCode: 409, statusMessage: 'Issue changed; reload before editing', data: { currentVersion: issue.version } })
        const triage = input.state !== undefined || input.assignee !== undefined || input.labels !== undefined
        if (triage && !allowed.triage) failure(403, 'Issue triage is required')
        const text = validateIssueText({ title: input.title ?? issue.title, body: input.body ?? issue.body })
        if (input.state && !['open', 'closed'].includes(input.state)) failure(400, 'Invalid issue state')
        if (input.assignee) {
          const eligible = await tx.select({ id: repos.id }).from(repos).where(and(eq(repos.id, issue.repoId), repositoryAccessPredicate(input.assignee, audience))).get()
          if (!eligible) failure(400, 'Assignee must have current repository access')
        }
        if (input.labels) {
          if (input.labels.length > 20 || new Set(input.labels).size !== input.labels.length) failure(400, 'Invalid labels')
          for (const id of input.labels) {
            const label = await tx.select().from(issueLabels).where(and(eq(issueLabels.id, id), eq(issueLabels.repoId, issue.repoId), eq(issueLabels.archived, 0))).get()
            if (!label) failure(400, 'Label is not available in this repository')
          }
          await tx.delete(issueLabelLinks).where(eq(issueLabelLinks.issueId, issue.id))
          for (const labelId of input.labels) await tx.insert(issueLabelLinks).values({ issueId: issue.id, labelId })
        }
        const state = input.state ?? issue.state
        await tx.update(issues).set({ ...text, state, assignee: input.assignee === undefined ? issue.assignee : input.assignee, version: issue.version + 1, updatedAt: Date.now(), closedAt: state === 'closed' ? issue.closedAt ?? Date.now() : null }).where(eq(issues.id, id))
        await event(tx, id, 'updated', { version: issue.version + 1, previousState: issue.state, state, previousAssignee: issue.assignee, assignee: input.assignee, labels: input.labels })
      })
    },
    capabilities,
    repoAccess,
    requireIssue,
    createRow,
    event,
  }
}
