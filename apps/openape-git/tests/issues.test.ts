import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { databaseMigrations, migrateDatabase } from '../server/database/migrations'
import * as schema from '../server/database/schema'
import { createIssueStore } from '../server/utils/issues'

let directory: string
let client: ReturnType<typeof createClient>
let db: ReturnType<typeof drizzle<typeof schema>>
const owner = { subject: 'owner@example.com', actor: 'owner@example.com' }
const other = { subject: 'other@example.com', actor: 'other@example.com' }
const reader = { subject: 'reader@example.com', actor: 'reader@example.com' }
const audience = 'repos.openape.ai'
const store = (principal = owner) => createIssueStore(db, audience, principal)

async function grant(status = 'approved', expiresAt: number | null = null, targetAudience = audience) {
  await db.insert(schema.grants).values({ id: 'grant', type: 'delegation', status, requester: owner.subject, targetHost: audience, audience: targetAudience, grantType: 'timed', createdAt: 1, expiresAt, request: { delegate: reader.subject, audience: targetAudience, grant_type: 'timed', scopes: ['git:read', 'repo:owner/project'] } })
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'native-issues-'))
  client = createClient({ url: `file:${directory}/test.db` })
  await migrateDatabase(client)
  db = drizzle(client, { schema })
  await db.insert(schema.repos).values([{ id: 'repo', owner: 'owner', name: 'project', ownerEmail: owner.subject, createdAt: 1 }, { id: 'other', owner: 'other', name: 'private', ownerEmail: other.subject, createdAt: 1 }])
})
afterEach(() => { client.close(); rmSync(directory, { recursive: true, force: true }) })

describe('private issue storage', () => {
  it('adopts a pre-issue registry and preserves existing PRs during the upgrade', async () => {
    const legacy = createClient({ url: `file:${directory}/legacy.db` })
    try {
      for (const statement of databaseMigrations[0]!.statements) await legacy.execute(statement)
      await legacy.execute({ sql: 'INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)', args: ['legacy', 'old', 'repo', owner.subject, 'main', 1] })
      await legacy.execute({ sql: 'INSERT INTO pulls (id, repo_id, number, title, source_ref, target_ref, author_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: ['old-pr', 'legacy', 43, 'Keep me', 'feature', 'main', owner.subject, 1] })
      await migrateDatabase(legacy)
      await migrateDatabase(legacy)
      expect((await legacy.execute('SELECT title, number FROM pulls')).rows).toEqual([{ title: 'Keep me', number: 43 }])
      expect((await legacy.execute('SELECT reporting_enabled, issue_home_only FROM repos')).rows).toEqual([{ reporting_enabled: 0, issue_home_only: 0 }])
    }
    finally {
      legacy.close()
    }
  })

  it('upgrades once, preserves existing Git data and rolls back a failed migration', async () => {
    await db.insert(schema.pulls).values({ id: 'pr', repoId: 'repo', number: 7, title: 'Existing pull', sourceRef: 'feature', targetRef: 'main', authorEmail: owner.subject, createdAt: 1 })
    await grant()
    await migrateDatabase(client)
    await expect(migrateDatabase(client, [...databaseMigrations, { version: 3, name: 'broken', statements: ['CREATE TABLE should_rollback (id TEXT)', 'INVALID SQL'] }])).rejects.toThrow()
    expect((await client.execute('SELECT name FROM sqlite_master WHERE name=\'should_rollback\'')).rows).toHaveLength(0)
    expect((await db.select().from(schema.pulls))[0]!.title).toBe('Existing pull')
    expect(await db.select().from(schema.grants)).toHaveLength(1)
    expect((await client.execute('SELECT * FROM schema_migrations')).rows).toHaveLength(2)
  })

  it('bounds reads, counts and filters by live access, including revocation', async () => {
    const id = await store().create('repo', { title: 'Private issue', body: 'secret' }, 'create-001')
    await store(other).create('other', { title: 'Another private issue', body: 'hidden' }, 'create-002')
    await expect(store(other).get(id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(store(reader).get(id)).rejects.toMatchObject({ statusCode: 404 })
    await grant()
    expect((await store(reader).get(id)).title).toBe('Private issue')
    expect(await store(reader).list()).toMatchObject({ ids: [id], total: 1 })
    expect(await store(reader).list({ repo: 'other/private' })).toMatchObject({ ids: [], total: 0 })
    await client.execute('UPDATE grants SET status=\'revoked\'')
    expect(await store(reader).list()).toMatchObject({ ids: [], total: 0 })
    await expect(store(reader).get(id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each(['expired', 'audience'])('rejects a grant with wrong %s', async (kind) => {
    const id = await store().create('repo', { title: 'Private', body: '' }, 'create-001')
    await grant('approved', kind === 'expired' ? 1 : null, kind === 'audience' ? 'elsewhere' : audience)
    await expect(store(reader).get(id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('grants narrow participation without repository metadata or another issue', async () => {
    const id = await store().create('repo', { title: 'My report', body: '' }, 'create-001')
    const hidden = await store().create('repo', { title: 'Other report', body: '' }, 'create-002')
    await db.insert(schema.issueParticipants).values({ issueId: id, subject: other.subject, createdBy: owner.subject, createdAt: 1 })
    expect(await store(other).get(id)).toMatchObject({ title: 'My report', number: null, repositoryUrl: null, capabilities: { repository: null, triage: false } })
    await expect(store(other).get(hidden)).rejects.toMatchObject({ statusCode: 404 })
    expect(await store(other).list({ repo: 'owner/project' })).toMatchObject({ total: 0 })
    await store(other).comment(id, 'Follow up', 'comment-001')
    await client.execute('DELETE FROM issue_participants')
    await expect(store(other).comments(id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('allocates unique numbers and makes create/comment retries idempotent', async () => {
    const input = { title: 'First', body: 'literal $HOME `code`\nsecond line' }
    const ids = await Promise.all([store().create('repo', input, 'create-001'), store().create('repo', { title: 'Second', body: '' }, 'create-002')])
    expect(new Set(ids).size).toBe(2)
    expect((await db.select().from(schema.issues)).map(row => row.number).sort()).toEqual([1, 2])
    expect(await store().create('repo', input, 'create-001')).toBe(ids[0])
    await expect(store().create('repo', { ...input, title: 'Changed' }, 'create-001')).rejects.toMatchObject({ statusCode: 409 })
    const comment = await store().comment(ids[0]!, 'Comment', 'comment-001')
    expect(await store().comment(ids[0]!, 'Comment', 'comment-001')).toBe(comment)
    expect(await store().comments(ids[0]!)).toHaveLength(1)
  })

  it('rejects stale revisions, reader triage and assignment that would imply access', async () => {
    await grant()
    const id = await store(reader).create('repo', { title: 'Reader issue', body: '' }, 'create-001')
    await store(reader).update(id, { title: 'Edited', expectedVersion: 1 })
    await expect(store().update(id, { state: 'closed', expectedVersion: 1 })).rejects.toMatchObject({ statusCode: 409 })
    await expect(store(reader).update(id, { state: 'closed', expectedVersion: 2 })).rejects.toMatchObject({ statusCode: 403 })
    await expect(store().update(id, { assignee: other.subject, expectedVersion: 2 })).rejects.toMatchObject({ statusCode: 400 })
    await store().update(id, { state: 'closed', assignee: reader.subject, expectedVersion: 2 })
    expect(await store().get(id)).toMatchObject({ state: 'closed', version: 3, assignee: reader.subject })
  })

  it('treats search wildcards literally and rejects invalid or changed-filter cursors', async () => {
    const first = await store().create('repo', { title: '100% complete', body: '' }, 'create-001')
    await store().create('repo', { title: '100 records', body: '' }, 'create-002')
    expect(await store().list({ q: '100%' })).toMatchObject({ ids: [first], total: 1 })
    const page = await store().list({ limit: 1 })
    expect(page.total).toBe(2)
    expect(page.cursor).toBeTruthy()
    const next = await store().list({ limit: 1, cursor: page.cursor! })
    expect(next.ids).toHaveLength(1)
    expect(next.ids[0]).not.toBe(page.ids[0])
    await expect(store().list({ q: 'changed', cursor: page.cursor! })).rejects.toMatchObject({ statusCode: 400 })
    await expect(store().list({ cursor: Buffer.from('null').toString('base64url') })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('honors scope bounds and preserves delegated authorship', async () => {
    const delegated = createIssueStore(db, audience, { ...owner, actor: 'agent@example.com', scope: ['issues:create'] })
    const id = await delegated.create('repo', { title: 'Delegated', body: '' }, 'create-001')
    expect(await store().get(id)).toMatchObject({ authorSubject: owner.subject, authorActor: 'agent@example.com' })
    for (const scope of [[], ['issues:read'], ['repos:write']]) {
      const restricted = createIssueStore(db, audience, { ...owner, scope })
      await expect(restricted.comment(id, 'No', 'comment-001')).rejects.toMatchObject({ statusCode: 403 })
      await expect(restricted.update(id, { state: 'closed', expectedVersion: 1 })).rejects.toMatchObject({ statusCode: 403 })
    }
  })
})
