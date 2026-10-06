import type { H3Event } from 'h3'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { createError, getHeader, getQuery, getRouterParam, setResponseStatus } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { issueAliases, issueLabelLinks, issueLabels, issueParticipants, issues, products, repos } from '../database/schema'
import { repositoryAccessPredicate } from './issue-access'
import { issueBody, issueContext, issueIdentity, issueRepository, issueText, issueVersion, issueView } from './issue-api'
import { issueTransaction, nextNumber, validateIssueText, writeOnce } from './issues'

type Context = Awaited<ReturnType<typeof issueContext>>
type Store = Parameters<Parameters<typeof issueTransaction>[1]>[0] | Context['db']
const disclosure = 'Visible to you and the people authorized to read this product’s private development issues. Every comment in this discussion is shared with you.'

async function reportRoute(db: Store, requestedKey: string) {
  const config = useRuntimeConfig()
  const product = await db.select().from(products).where(and(eq(products.key, requestedKey), eq(products.enabled, 1))).get()
  const target = product ? await db.select().from(repos).where(and(eq(repos.id, product.repoId), eq(repos.reportingEnabled, 1))).get() : null
  const intake = target ? null : await db.select().from(repos).where(and(eq(repos.id, config.issueIntakeRepoId as string), eq(repos.reportingEnabled, 1))).get()
  const destination = target ?? intake
  if (!destination) throw createError({ statusCode: 503, statusMessage: 'Reporting is unavailable. Keep your draft and retry later.' })
  const active = target ? product : null
  const routingVersion = createHash('sha256').update(JSON.stringify([active?.key, active?.version, destination.id, destination.issuePolicyVersion])).digest('hex')
  return { destination, product: active, descriptor: { key: active?.key ?? null, name: active?.name ?? 'Unclassified', routingVersion, audience: disclosure, unclassified: !active } }
}

export async function reportingProducts(event: H3Event) {
  const context = await issueContext(event, ['products:read'])
  const query = getQuery(event)
  if (Object.keys(query).some(key => key !== 'product')) throw createError({ statusCode: 400, statusMessage: 'Unknown product filter' })
  const requested = query.product === undefined ? '' : issueText(query.product, 'product', 100)
  const choices = await context.db.select({ key: products.key, name: products.name }).from(products).innerJoin(repos, eq(repos.id, products.repoId)).where(and(eq(products.enabled, 1), eq(repos.reportingEnabled, 1))).orderBy(products.name)
  const route = await reportRoute(context.db, requested)
  return { products: choices, selected: route.descriptor }
}

export async function createReport(event: H3Event) {
  const context = await issueContext(event, ['reports:create'])
  const input = await issueBody(event, ['productKey', 'routingVersion', 'title', 'body'])
  const productKey = input.productKey === null || input.productKey === undefined ? '' : issueText(input.productKey, 'product', 100)
  const routingVersion = issueText(input.routingVersion, 'routing version', 64)
  const text = validateIssueText({ title: issueText(input.title, 'title', 200), body: issueText(input.body, 'body', 400000) })
  const id = await issueTransaction(context.db, tx => writeOnce(tx, context.principal, 'report', getHeader(event, 'idempotency-key') ?? '', { productKey, routingVersion, ...text }, async () => {
    const route = await reportRoute(tx, productKey)
    if (routingVersion !== route.descriptor.routingVersion) throw createError({ statusCode: 409, statusMessage: 'Reporting destination changed. Review the current audience before submitting again.' })
    const id = await context.store.createRow(tx, route.destination.id, text, route.product?.key ?? null, true)
    if (!route.product) await tx.update(issues).set({ triageState: 'unclassified' }).where(eq(issues.id, id))
    return id
  }))
  setResponseStatus(event, 201)
  const issue = await issueView(context, id)
  return { ...issue, number: null, repositoryUrl: null, capabilities: { ...issue.capabilities, repository: null } }
}

export async function getIssuePolicy(event: H3Event) {
  const context = await issueContext(event, ['issues:admin'])
  const repo = await issueRepository(event, context, 'admin')
  return { reportingEnabled: Boolean(repo.reportingEnabled), version: repo.issuePolicyVersion, products: await context.db.select().from(products).where(eq(products.repoId, repo.id)), canCreateProduct: context.principal.subject === useRuntimeConfig().issueRoutingAdmin }
}

export async function updateIssuePolicy(event: H3Event) {
  const context = await issueContext(event, ['issues:admin'])
  const repo = await issueRepository(event, context, 'admin')
  const input = await issueBody(event, ['reportingEnabled', 'expectedVersion'], 1024)
  const expected = issueVersion(input.expectedVersion)
  if (typeof input.reportingEnabled !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Reporting enabled must be boolean' })
  await issueTransaction(context.db, async (tx) => {
    const current = await context.store.repoAccess(tx, repo.id, 'admin')
    if (!current) throw createError({ statusCode: 403, statusMessage: 'Repository admin permission required' })
    if (current.issuePolicyVersion !== expected) throw createError({ statusCode: 409, statusMessage: 'Reporting policy changed; reload before editing' })
    await tx.update(repos).set({ reportingEnabled: input.reportingEnabled ? 1 : 0, issuePolicyVersion: expected + 1 }).where(eq(repos.id, repo.id))
  })
  return { version: expected + 1, reportingEnabled: input.reportingEnabled }
}

export async function saveIssueProduct(event: H3Event) {
  const context = await issueContext(event, ['issues:admin'])
  const repo = await issueRepository(event, context, 'admin')
  const key = getRouterParam(event, 'key') ?? ''
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(key)) throw createError({ statusCode: 400, statusMessage: 'Invalid product key' })
  const input = await issueBody(event, ['name', 'enabled', 'expectedVersion'], 2048)
  const name = issueText(input.name, 'product name', 100).trim()
  if (!name || typeof input.enabled !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Product name and enabled flag required' })
  if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 0) throw createError({ statusCode: 400, statusMessage: 'Expected version required; use zero for a new product' })
  return issueTransaction(context.db, async (tx) => {
    if (!await context.store.repoAccess(tx, repo.id, 'admin')) throw createError({ statusCode: 403, statusMessage: 'Repository admin permission required' })
    const existing = await tx.select().from(products).where(eq(products.key, key)).get()
    const globalAdmin = context.principal.subject === useRuntimeConfig().issueRoutingAdmin
    if ((!existing || existing.repoId !== repo.id) && !globalAdmin) throw createError({ statusCode: 403, statusMessage: 'Routing administrator and destination administrator approval required' })
    if ((existing?.version ?? 0) !== input.expectedVersion) throw createError({ statusCode: 409, statusMessage: 'Product route changed; reload before editing' })
    const values = { key, name, repoId: repo.id, routingAdmin: String(useRuntimeConfig().issueRoutingAdmin), approvedBy: context.principal.subject, enabled: input.enabled ? 1 : 0, version: Number(input.expectedVersion) + 1 }
    if (existing) await tx.update(products).set(values).where(eq(products.key, key))
    else await tx.insert(products).values(values)
    return values
  })
}

export async function transferIssue(event: H3Event) {
  const context = await issueContext(event, ['issues:triage'])
  const id = await issueIdentity(event, context)
  const input = await issueBody(event, ['productKey', 'labelMap', 'expectedVersion'], 8192)
  const productKey = issueText(input.productKey, 'product', 64)
  const expected = issueVersion(input.expectedVersion)
  if (!input.labelMap || typeof input.labelMap !== 'object' || Array.isArray(input.labelMap)) throw createError({ statusCode: 400, statusMessage: 'Explicit label mapping required' })
  const labelMap = input.labelMap as Record<string, unknown>
  await issueTransaction(context.db, async (tx) => {
    const issue = await context.store.requireIssue(tx, id)
    if (issue.repoId !== useRuntimeConfig().issueIntakeRepoId) throw createError({ statusCode: 400, statusMessage: 'Only intake issues may be transferred' })
    if (!(await context.store.capabilities(tx, issue)).triage) throw createError({ statusCode: 403, statusMessage: 'Source issue triage permission required' })
    const product = await tx.select().from(products).where(and(eq(products.key, productKey), eq(products.enabled, 1))).get()
    if (!product || !await context.store.repoAccess(tx, product.repoId, 'write')) throw createError({ statusCode: 404, statusMessage: 'Destination not found' })
    if (issue.version !== expected) throw createError({ statusCode: 409, statusMessage: 'Issue changed; reload before transferring' })
    const previousLabels = await tx.select().from(issueLabelLinks).where(eq(issueLabelLinks.issueId, id))
    if (Object.keys(labelMap).length !== previousLabels.length || previousLabels.some(label => !(label.labelId in labelMap))) throw createError({ statusCode: 400, statusMessage: 'Map every source label explicitly, or use null to remove it' })
    const destinationLabels = new Set<string>()
    for (const value of Object.values(labelMap)) {
      if (value === null) continue
      const labelId = issueText(value, 'destination label', 100)
      if (!await tx.select().from(issueLabels).where(and(eq(issueLabels.id, labelId), eq(issueLabels.repoId, product.repoId), eq(issueLabels.archived, 0))).get()) throw createError({ statusCode: 400, statusMessage: 'Invalid destination label' })
      destinationLabels.add(labelId)
    }
    const number = issue.repoId === product.repoId ? issue.number : await nextNumber(tx, product.repoId)
    if (issue.repoId !== product.repoId) await tx.insert(issueAliases).values({ repoId: product.repoId, number, issueId: id })
    await tx.delete(issueLabelLinks).where(eq(issueLabelLinks.issueId, id))
    for (const labelId of destinationLabels) await tx.insert(issueLabelLinks).values({ issueId: id, labelId })
    await tx.update(issues).set({ repoId: product.repoId, number, productKey, triageState: 'classified', assignee: null, version: expected + 1, updatedAt: Date.now() }).where(eq(issues.id, id))
    await context.store.event(tx, id, 'transferred', { sourceRepoId: issue.repoId, destinationRepoId: product.repoId, previousNumber: issue.number, number, productKey, labelMap, clearedAssignee: issue.assignee })
  })
  return issueView(context, id)
}

export async function issueTransferOptions(event: H3Event) {
  const context = await issueContext(event, ['issues:triage'])
  const id = await issueIdentity(event, context)
  const issue = await context.store.requireIssue(context.db, id)
  if (!(await context.store.capabilities(context.db, issue)).triage) throw createError({ statusCode: 403, statusMessage: 'Issue triage permission required' })
  const choices = await context.db.select({ key: products.key, name: products.name, repoId: repos.id }).from(products).innerJoin(repos, eq(repos.id, products.repoId)).where(and(eq(products.enabled, 1), repositoryAccessPredicate(context.principal.subject, context.audience, 'write'))).orderBy(products.name)
  return { products: await Promise.all(choices.map(async ({ repoId, ...product }) => ({ ...product, labels: await context.db.select({ id: issueLabels.id, name: issueLabels.name }).from(issueLabels).where(and(eq(issueLabels.repoId, repoId), eq(issueLabels.archived, 0))) }))) }
}

export async function moderateIssue(event: H3Event) {
  const context = await issueContext(event, ['issues:admin'])
  const id = await issueIdentity(event, context)
  const input = await issueBody(event, ['hidden', 'revokeParticipant', 'reason', 'expectedVersion'], 4096)
  const expected = issueVersion(input.expectedVersion)
  const reason = issueText(input.reason, 'reason', 1000).trim()
  if (!reason || (input.hidden === undefined && input.revokeParticipant === undefined)) throw createError({ statusCode: 400, statusMessage: 'Moderation action and reason required' })
  if (input.hidden !== undefined && typeof input.hidden !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Hidden must be boolean' })
  await issueTransaction(context.db, async (tx) => {
    const issue = await context.store.requireIssue(tx, id)
    if (!(await context.store.capabilities(tx, issue)).admin) throw createError({ statusCode: 403, statusMessage: 'Issue admin permission required' })
    if (issue.version !== expected) throw createError({ statusCode: 409, statusMessage: 'Issue changed; reload before moderation' })
    if (input.revokeParticipant !== undefined) await tx.delete(issueParticipants).where(and(eq(issueParticipants.issueId, id), eq(issueParticipants.subject, issueText(input.revokeParticipant, 'participant', 255))))
    await tx.update(issues).set({ hidden: input.hidden === undefined ? issue.hidden : input.hidden ? 1 : 0, version: expected + 1, updatedAt: Date.now() }).where(eq(issues.id, id))
    await context.store.event(tx, id, 'moderated', { reason, hidden: input.hidden, revokedParticipant: input.revokeParticipant })
  })
  return { id, version: expected + 1 }
}
