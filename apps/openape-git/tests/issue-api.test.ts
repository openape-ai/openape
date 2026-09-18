import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { createApp, createRouter, defineEventHandler, toNodeListener, updateSession } from 'h3'
import { SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateDatabase } from '../server/database/migrations'
import * as schema from '../server/database/schema'
import { issueScopes } from '../shared/issue-scopes'

const { getDb, runtimeConfig } = vi.hoisted(() => ({ getDb: vi.fn(), runtimeConfig: vi.fn() }))
vi.mock('../server/database/drizzle', () => ({ useDb: getDb }))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: runtimeConfig }))
const handlers = await import('../server/utils/issue-handlers')
const { issueFacets } = await import('../server/utils/issue-facets')
const reporting = await import('../server/utils/issue-reporting')
const labels = await import('../server/utils/issue-labels')
const { requireScopedPrincipal } = await import('../../../modules/nuxt-auth-sp/src/runtime/server/utils/verified-principal')
vi.stubGlobal('requireScopedPrincipal', requireScopedPrincipal)

const secret = 'native-issues-http-fixture-secret-at-least-32-characters'
const audience = 'repos.test'
const owner = 'owner@e2e.test'
const reader = 'reader@e2e.test'
let client: ReturnType<typeof createClient>
let server: Server
let directory: string
let base: string
let token: string

async function bearer(subject: string, scope?: string[], aud = audience) {
  return new SignJWT({ typ: 'cli', sub: subject, email: subject, act: 'human', ...(scope === undefined ? {} : { scope }) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(audience)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret))
}

async function call(method: string, path: string, body?: unknown, authorization = token, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { method, headers: { ...(authorization ? { authorization: `Bearer ${authorization}` } : {}), 'content-type': 'application/json', 'idempotency-key': 'http-test-001', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
const root = '/api/repos/owner/project'

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'issue-api-'))
  client = createClient({ url: `file:${directory}/registry.db` })
  await migrateDatabase(client)
  const db = drizzle(client, { schema })
  getDb.mockReturnValue(db)
  runtimeConfig.mockReturnValue({ public: { issuesEnabled: true }, issueIntakeRepoId: 'intake', issueRoutingAdmin: owner, openapeSp: { clientId: audience, sessionSecret: secret, catalogOnlyScopes: issueScopes.map(scope => scope.id), manifest: { scopes: issueScopes } } })
  await db.insert(schema.repos).values({ id: 'repo', owner: 'owner', name: 'project', ownerEmail: owner, createdAt: 1 })
  await db.insert(schema.grants).values({ id: 'reader-grant', status: 'approved', type: 'delegation', requester: owner, targetHost: audience, audience, grantType: 'always', createdAt: 1, request: { delegate: reader, audience, grant_type: 'always', scopes: ['git:read', 'repo:owner/project'] } })
  await db.insert(schema.repos).values({ id: 'intake', owner: 'owner', name: 'intake', ownerEmail: owner, reportingEnabled: 1, createdAt: 1 })
  const router = createRouter()
  router.get('/api/products', defineEventHandler(reporting.reportingProducts))
  router.post('/api/reports', defineEventHandler(reporting.createReport))
  router.get('/api/repos/:owner/:name/issue-policy', defineEventHandler(reporting.getIssuePolicy))
  router.patch('/api/repos/:owner/:name/issue-policy', defineEventHandler(reporting.updateIssuePolicy))
  router.put('/api/repos/:owner/:name/issue-products/:key', defineEventHandler(reporting.saveIssueProduct))
  router.get('/api/issue-facets', defineEventHandler(issueFacets))
  router.get('/api/issues', defineEventHandler(handlers.listIssues))
  router.get('/api/repos/:owner/:name/issues', defineEventHandler(handlers.listIssues))
  router.post('/api/repos/:owner/:name/issues', defineEventHandler(handlers.createIssue))
  for (const path of ['/api/repos/:owner/:name/issues/:number', '/api/issue-records/:id']) {
    router.post(`${path}/transfer`, defineEventHandler(reporting.transferIssue))
    router.get(`${path}/transfer-options`, defineEventHandler(reporting.issueTransferOptions))
    router.post(`${path}/moderation`, defineEventHandler(reporting.moderateIssue))
    router.get(path, defineEventHandler(handlers.getIssue))
    router.patch(path, defineEventHandler(handlers.updateIssue))
    router.get(`${path}/comments`, defineEventHandler(handlers.listIssueComments))
    router.post(`${path}/comments`, defineEventHandler(handlers.createIssueComment))
    router.patch(`${path}/comments/:commentId`, defineEventHandler(handlers.updateIssueComment))
  }
  router.get('/api/repos/:owner/:name/labels', defineEventHandler(labels.listIssueLabels))
  router.post('/api/repos/:owner/:name/labels', defineEventHandler(labels.saveIssueLabel))
  router.patch('/api/repos/:owner/:name/labels/:labelId', defineEventHandler(labels.saveIssueLabel))
  router.get('/api/repos/:owner/:name/issue-assignees', defineEventHandler(labels.listIssueAssignees))
  router.get('/fixture/session', defineEventHandler(async (event) => {
    await updateSession(event, { name: 'openape-sp', password: secret }, { claims: { sub: owner, act: 'human' } })
    return { ok: true }
  }))
  server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  token = await bearer(owner)
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()) })
  client.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('native issue HTTP contract', () => {
  it('roundtrips Markdown, retries once, edits with versions, comments and manually closes', async () => {
    const body = { title: 'A real problem', body: 'First line\n\n`$HOME` **bold** ![Remote](https://example.com/pixel.png) <script>bad()</script>' }
    const created = await call('POST', `${root}/issues`, body)
    expect(created.status).toBe(201)
    expect(created.headers.get('cache-control')).toBe('private, no-store')
    const issue = await created.json()
    expect(issue.body).toBe(body.body)
    expect(issue.bodyHtml).toContain('<strong>bold</strong>')
    expect(issue.bodyHtml).not.toMatch(/<img|<script/)
    expect(issue.bodyHtml).toContain('href="https://example.com/pixel.png"')
    expect((await (await call('POST', `${root}/issues`, body)).json()).id).toBe(issue.id)
    expect((await call('POST', `${root}/issues`, { ...body, title: 'Changed retry' })).status).toBe(409)
    const path = `/api/issue-records/${issue.id}`
    expect((await call('PATCH', path, { title: 'Edited title', expectedVersion: 1 })).status).toBe(200)
    expect((await call('PATCH', path, { state: 'closed', expectedVersion: 1 })).status).toBe(409)
    const comment = await (await call('POST', `${path}/comments`, { body: 'A comment' })).json()
    expect((await call('PATCH', `${path}/comments/${comment.id}`, { body: 'Edited comment', expectedVersion: 1 })).status).toBe(200)
    expect((await call('PATCH', `${path}/comments/${comment.id}`, { body: 'Stale', expectedVersion: 1 })).status).toBe(409)
    expect((await call('PATCH', path, { state: 'closed', expectedVersion: 2 })).status).toBe(200)
    expect((await (await call('GET', '/api/issues')).json()).total).toBe(0)
    expect((await (await call('GET', '/api/issues?state=closed')).json()).total).toBe(1)
    expect((await (await call('GET', `${path}/comments`)).json()).comments[0].body).toBe('Edited comment')
  })

  it('rejects unauthenticated, unrelated and scope-limited callers without leaking metadata', async () => {
    await call('POST', `${root}/issues`, { title: 'Secret issue', body: 'Secret body' })
    expect((await call('GET', `${root}/issues/1`, undefined, '')).status).toBe(401)
    const outsider = await bearer('outside@e2e.test')
    const hidden = await call('GET', `${root}/issues/1`, undefined, outsider)
    expect(hidden.status).toBe(404)
    expect(await hidden.text()).not.toMatch(/Secret issue|Secret body/)
    expect((await (await call('GET', '/api/issues', undefined, outsider)).json()).total).toBe(0)
    for (const scope of [[], ['issues:read'], ['repos:write']]) {
      expect((await call('POST', `${root}/issues/1/comments`, { body: 'Denied' }, await bearer(owner, scope))).status).toBe(403)
    }
    expect((await call('GET', `${root}/issues/1`, undefined, await bearer(owner, undefined, 'wrong.test'))).status).toBe(401)
    const label = await (await call('POST', `${root}/labels`, { name: 'Secret label', color: '#ff0000' })).json()
    await call('PATCH', `${root}/issues/1`, { labels: [label.id], assignee: reader, expectedVersion: 1 })
    const readerToken = await bearer(reader)
    const facets = await (await call('GET', '/api/issue-facets', undefined, readerToken)).json()
    expect(facets.labels).toEqual([{ id: label.id, name: 'Secret label' }])
    expect(await (await call('GET', '/api/issue-facets', undefined, outsider)).json()).toMatchObject({ repositories: [], labels: [], products: [], assignees: [] })
    expect((await call('GET', `${root}/issues/1`, undefined, readerToken)).status).toBe(200)
    expect((await call('PATCH', `${root}/issues/1`, { state: 'closed', expectedVersion: 2 }, readerToken)).status).toBe(403)
    await client.execute('UPDATE grants SET status=\'revoked\'')
    expect((await call('GET', `${root}/issues/1`, undefined, readerToken)).status).toBe(404)
    expect(await (await call('GET', '/api/issue-facets', undefined, readerToken)).json()).toMatchObject({ repositories: [], labels: [], products: [], assignees: [] })
  })

  it('rejects identity injection, oversized requests, invalid filters and cookie CSRF', async () => {
    expect((await call('POST', `${root}/issues`, { title: 'No', body: '', authorSubject: 'victim@e2e.test' })).status).toBe(400)
    expect((await call('POST', `${root}/issues`, { title: 'No', body: 'a'.repeat(71000) })).status).toBe(413)
    expect((await call('GET', '/api/issues?state=invalid')).status).toBe(400)
    const session = await fetch(`${base}/fixture/session`)
    const cookie = session.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    expect(cookie).toContain('openape-sp=')
    const input = { title: 'Cookie issue', body: '' }
    expect((await call('POST', `${root}/issues`, input, '', { cookie, origin: 'https://evil.test' })).status).toBe(403)
    expect((await call('POST', `${root}/issues`, input, '', { cookie })).status).toBe(403)
    expect((await call('POST', `${root}/issues`, input, '', { cookie, origin: base })).status).toBe(201)
  })

  it('keeps reporter-only responses and discussions independent of repository access', async () => {
    const created = await (await call('POST', `${root}/issues`, { title: 'One report', body: '' })).json()
    await call('POST', `${root}/issues`, { title: 'Another report', body: '' }, token, { 'idempotency-key': 'another-key' })
    await client.execute({ sql: 'INSERT INTO issue_participants VALUES (?, ?, ?, ?)', args: [created.id, 'reporter@e2e.test', owner, Date.now()] })
    const reporter = await bearer('reporter@e2e.test')
    const visible = await (await call('GET', `/api/issue-records/${created.id}`, undefined, reporter)).json()
    expect(visible.repositoryUrl).toBeNull()
    expect(visible.number).toBeNull()
    expect(JSON.stringify(visible)).not.toContain('owner/project')
    expect((await call('GET', `${root}/issues/1`, undefined, reporter)).status).toBe(404)
    expect((await (await call('GET', '/api/issues', undefined, reporter)).json()).total).toBe(1)
    expect((await call('POST', `/api/issue-records/${created.id}/comments`, { body: 'I can follow my report' }, reporter)).status).toBe(201)
  })

  it('allows admin label management and only eligible assignees, preserving label history', async () => {
    await call('POST', `${root}/issues`, { title: 'Label me', body: '' })
    const labelResponse = await call('POST', `${root}/labels`, { name: 'bug', color: '#ef4444' })
    expect(labelResponse.status).toBe(201)
    const label = await labelResponse.json()
    expect((await call('PATCH', `${root}/issues/1`, { expectedVersion: 1, labels: [label.id], assignee: 'outsider@e2e.test' })).status).toBe(400)
    expect((await call('PATCH', `${root}/issues/1`, { expectedVersion: 1, labels: [label.id], assignee: reader })).status).toBe(200)
    expect((await call('PATCH', `${root}/labels/${label.id}`, { expectedVersion: 1, archived: true })).status).toBe(200)
    expect((await (await call('GET', `${root}/issues/1`)).json()).labels[0].name).toBe('bug')
    expect((await call('POST', `${root}/labels`, { name: 'unauthorized', color: '#ffffff' }, await bearer(reader))).status).toBe(403)
    expect((await call('GET', `${root}/issue-assignees`, undefined, await bearer(reader))).status).toBe(403)
    expect((await (await call('GET', `${root}/issue-assignees`)).json()).assignees).toEqual([owner, reader])
  })
})

describe('product reporting and triage', () => {
  async function enableProduct() {
    expect((await call('PATCH', `${root}/issue-policy`, { reportingEnabled: true, expectedVersion: 1 })).status).toBe(200)
    expect((await call('PUT', `${root}/issue-products/plans`, { name: 'Plans', enabled: true, expectedVersion: 0 })).status).toBe(200)
  }
  async function submit(product: string, reporter: string, key = 'report-create-001') {
    const catalog = await (await call('GET', `/api/products?product=${product}`, undefined, reporter)).json()
    const input = { productKey: product, routingVersion: catalog.selected.routingVersion, title: 'Report with product context', body: 'Private reporter discussion' }
    const response = await call('POST', '/api/reports', input, reporter, { 'idempotency-key': key })
    expect(response.status).toBe(201)
    return { input, issue: await response.json() }
  }
  it('accepts one report from a scoped outsider without granting repository or unrelated issue access', async () => {
    await enableProduct()
    const reporter = await bearer('reporter@e2e.test', ['products:read', 'reports:create', 'issues:read', 'issues:comment', 'issues:edit-own'])
    const { issue, input } = await submit('plans', reporter)
    expect(JSON.stringify(issue)).not.toContain('owner/project')
    expect(issue).toMatchObject({ productName: 'Plans', number: null, repositoryUrl: null, triageState: 'classified' })
    expect((await (await call('POST', '/api/reports', input, reporter, { 'idempotency-key': 'report-create-001' })).json()).id).toBe(issue.id)
    expect((await call('GET', `${root}/issues`, undefined, reporter)).status).toBe(404)
    expect((await call('GET', `/api/issue-records/${issue.id}`, undefined, await bearer('other-reporter@e2e.test'))).status).toBe(404)
    expect((await call('POST', `/api/issue-records/${issue.id}/comments`, { body: 'Follow up' }, reporter)).status).toBe(201)
    expect((await call('PATCH', `/api/issue-records/${issue.id}`, { title: 'Corrected report', expectedVersion: 1 }, reporter)).status).toBe(200)
    expect((await call('PATCH', `/api/issue-records/${issue.id}`, { state: 'closed', expectedVersion: 2 }, reporter)).status).toBe(403)
    expect((await call('POST', '/api/reports', input, await bearer(owner, ['issues:create']))).status).toBe(403)
  })
  it('requires current routing disclosure and sends inactive/unknown products to private intake', async () => {
    await enableProduct()
    const reporter = await bearer('reporter@e2e.test')
    const before = await (await call('GET', '/api/products?product=plans', undefined, reporter)).json()
    expect(JSON.stringify(before)).not.toMatch(/repoId|owner\/project|routingAdmin|approvedBy/)
    await call('PATCH', `${root}/issue-policy`, { reportingEnabled: false, expectedVersion: 2 })
    expect((await call('POST', '/api/reports', { productKey: 'plans', routingVersion: before.selected.routingVersion, title: 'Stale route', body: '' }, reporter)).status).toBe(409)
    const { issue } = await submit('plans', reporter)
    expect(issue).toMatchObject({ productName: 'Unclassified', triageState: 'unclassified' })
    const unknown = await submit('unknown', reporter, 'report-unknown-001')
    expect(unknown.issue.triageState).toBe('unclassified')
    const queue = await (await call('GET', '/api/issues?triage=unclassified')).json()
    expect(queue.total).toBe(2)
    expect((await call('PUT', `${root}/issue-products/new`, { name: 'Wrong admin', enabled: true, expectedVersion: 0 }, await bearer(reader))).status).toBe(403)
    expect((await call('PATCH', `${root}/issue-policy`, { reportingEnabled: true, expectedVersion: 1 })).status).toBe(409)
  })
  it('keeps committed retries stable after routing changes and prevents unrelated owners from claiming products', async () => {
    await enableProduct()
    const reporter = await bearer('reporter@e2e.test')
    const { issue, input } = await submit('plans', reporter)
    await call('PATCH', `${root}/issue-policy`, { reportingEnabled: false, expectedVersion: 2 })
    const retry = await call('POST', '/api/reports', input, reporter, { 'idempotency-key': 'report-create-001' })
    expect(retry.status).toBe(201)
    expect((await retry.json()).id).toBe(issue.id)
    await getDb().insert(schema.repos).values({ id: 'other', owner: 'other', name: 'project', ownerEmail: 'other@e2e.test', createdAt: 1 })
    const other = await bearer('other@e2e.test')
    expect((await call('PUT', '/api/repos/other/project/issue-products/plans', { name: 'Hijacked', enabled: true, expectedVersion: 1 }, other)).status).toBe(403)
    expect((await call('PUT', '/api/repos/other/project/issue-products/new', { name: 'Unapproved', enabled: true, expectedVersion: 0 }, other)).status).toBe(403)
    expect((await call('POST', `/api/issue-records/${issue.id}/transfer`, { productKey: 'plans', labelMap: {}, expectedVersion: 1 })).status).toBe(400)
  })
  it('moves the same report, preserves aliases/comments, maps labels and revokes participation immediately', async () => {
    await enableProduct()
    const reporter = await bearer('reporter@e2e.test')
    const { issue } = await submit('unknown', reporter)
    const path = `/api/issue-records/${issue.id}`
    const intakeLabel = await (await call('POST', '/api/repos/owner/intake/labels', { name: 'needs-triage', color: '#ffaa00' })).json()
    const targetLabel = await (await call('POST', `${root}/labels`, { name: 'bug', color: '#ff0000' })).json()
    await call('PATCH', path, { expectedVersion: 1, labels: [intakeLabel.id], assignee: owner })
    const comment = await (await call('POST', `${path}/comments`, { body: 'Keep this discussion' }, reporter)).json()
    expect((await call('POST', `${path}/transfer`, { productKey: 'plans', labelMap: {}, expectedVersion: 2 })).status).toBe(400)
    expect((await call('POST', `${path}/transfer`, { productKey: 'plans', labelMap: { [intakeLabel.id]: targetLabel.id }, expectedVersion: 2 }, reporter)).status).toBe(403)
    const moved = await (await call('POST', `${path}/transfer`, { productKey: 'plans', labelMap: { [intakeLabel.id]: targetLabel.id }, expectedVersion: 2 })).json()
    expect(moved).toMatchObject({ id: issue.id, repositoryUrl: '/owner/project/issues/1', assignee: null, triageState: 'classified', version: 3 })
    expect(moved.labels[0].id).toBe(targetLabel.id)
    expect((await (await call('GET', '/api/repos/owner/intake/issues/1')).json()).id).toBe(issue.id)
    expect((await (await call('GET', `${path}/comments`, undefined, reporter)).json()).comments[0].id).toBe(comment.id)
    expect((await call('POST', `${path}/moderation`, { hidden: true, reason: 'Abuse review', expectedVersion: 3 })).status).toBe(200)
    expect((await call('GET', path, undefined, reporter)).status).toBe(404)
    expect((await call('POST', `${path}/moderation`, { hidden: false, reason: 'Review complete', expectedVersion: 4 })).status).toBe(200)
    expect((await call('GET', path, undefined, reporter)).status).toBe(200)
    expect((await call('POST', `${path}/moderation`, { revokeParticipant: 'reporter@e2e.test', reason: 'Owner requested removal', expectedVersion: 5 })).status).toBe(200)
    expect((await call('GET', path, undefined, reporter)).status).toBe(404)
    expect((await call('POST', `${path}/comments`, { body: 'Denied after revocation' }, reporter)).status).toBe(404)
    expect((await (await call('GET', '/api/issues', undefined, reporter)).json()).total).toBe(0)
  })
})
