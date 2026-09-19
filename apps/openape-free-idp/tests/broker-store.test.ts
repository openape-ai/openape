import type { BrokerConnection, BrokerRequest, OpenApeAuthZClaims, OpenApeGrant } from '@openape/core'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../server/database/schema'
import { createDrizzleBrokerStore } from '../server/utils/drizzle-broker-store'
import { createDrizzleGrantStore } from '../server/utils/drizzle-grant-store'

let directory: string
let client: ReturnType<typeof createClient>
let database: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../server/database/drizzle', () => ({ useDb: () => database }))
const owner = 'owner@identity.test'
const issuer = 'https://id.identity.test'
const broker = 'https://pods.provider.test'
const subject = 'agent@pods.provider.test'
let connection: BrokerConnection
let store: ReturnType<typeof createDrizzleBrokerStore>
let grantStore: ReturnType<typeof createDrizzleGrantStore>
function request(): BrokerRequest {
  const now = Math.floor(Date.now() / 1000)
  return { iss: broker, aud: issuer, owner, connection_id: connection.id, iat: now, exp: now + 60, jti: randomUUID(), operation: 'connection' }
}
function grant(type: 'once' | 'always' = 'once'): OpenApeGrant {
  return { id: randomUUID(), status: 'approved', created_at: 1, decided_by: owner, request: { requester: subject, target_host: 'pods:fixture', audience: 'shapes', grant_type: type, command: ['printf', 'fixture'] }, brokered: { connection_id: connection.id, broker_issuer: broker, agent_issuer: broker, owner, key_id: 'key-one' } }
}
function claims(value: OpenApeGrant): OpenApeAuthZClaims {
  const now = Math.floor(Date.now() / 1000)
  return { iss: issuer, sub: subject, aud: value.request.audience, target_host: value.request.target_host, grant_id: value.id, grant_type: value.request.grant_type, iat: now, exp: now + 300, jti: randomUUID(), decided_by: owner, brokered: value.brokered }
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'broker-store-'))
  client = createClient({ url: `file:${join(directory, 'idp.sqlite')}` })
  database = drizzle(client, { schema })
  await client.executeMultiple(`
    CREATE TABLE users(email TEXT PRIMARY KEY, id TEXT, name TEXT NOT NULL, owner TEXT, approver TEXT, type TEXT, public_key TEXT, is_active INTEGER NOT NULL, created_at INTEGER NOT NULL, last_login_at INTEGER, recovery_vacation_mode INTEGER NOT NULL DEFAULT 0, recovery_vacation_days INTEGER);
    CREATE TABLE ssh_keys(key_id TEXT PRIMARY KEY, user_email TEXT NOT NULL, public_key TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE grants(id TEXT PRIMARY KEY, status TEXT NOT NULL, type TEXT, requester TEXT NOT NULL, brokered TEXT, broker_owner TEXT, target_host TEXT NOT NULL, audience TEXT NOT NULL, grant_type TEXT NOT NULL, request TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER, decided_by TEXT, expires_at INTEGER, used_at INTEGER, decided_by_standing_grant TEXT, auto_approval_kind TEXT);
    CREATE TABLE broker_connections(id TEXT PRIMARY KEY, owner TEXT NOT NULL, owner_issuer TEXT NOT NULL, broker_issuer TEXT NOT NULL, agent_domain TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE broker_requests(connection_id TEXT NOT NULL, jti TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(connection_id,jti));
    CREATE TABLE broker_audit(id INTEGER PRIMARY KEY AUTOINCREMENT, grant_id TEXT NOT NULL, owner TEXT NOT NULL, agent TEXT NOT NULL, broker_issuer TEXT NOT NULL, connection_id TEXT NOT NULL, event TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE broker_agents(subject TEXT PRIMARY KEY, key_id TEXT NOT NULL, owner TEXT NOT NULL, decision_issuer TEXT NOT NULL, connection_id TEXT NOT NULL);
  `)
  await database.insert(schema.users).values({ email: owner, name: 'Owner', type: 'human', isActive: true, createdAt: 1 })
  store = createDrizzleBrokerStore()
  grantStore = createDrizzleGrantStore()
  connection = await store.createConnection({ id: randomUUID(), owner: { issuer, subject: owner }, broker_issuer: broker, agent_domain: 'pods.provider.test', status: 'active', created_at: 1 })
})
afterEach(() => { client.close(); rmSync(directory, { recursive: true, force: true }) })

describe('durable grant brokering', () => {
  it('accepts the authorized broker once and rejects replay, substituted owners and other domains', async () => {
    const assertion = request()
    await expect(store.acceptRequest(assertion)).resolves.toEqual(connection)
    await expect(store.acceptRequest(assertion)).rejects.toMatchObject({ statusCode: 409 })
    await expect(store.acceptRequest({ ...request(), owner: 'other@identity.test' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(store.acceptRequest({ ...request(), operation: 'get', sub: 'agent@elsewhere.test', key_id: 'key-one', grant_id: randomUUID() })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lists foreign grants for the owner without creating a local agent or leaking to another owner', async () => {
    const value = grant()
    await grantStore.save(value)
    expect(await database.select().from(schema.users)).toHaveLength(1)
    expect((await grantStore.listGrants!({ requester: [owner], brokerOwner: owner })).data).toMatchObject([value])
    expect((await grantStore.listGrants!({ requester: ['other@identity.test'], brokerOwner: 'other@identity.test' })).data).toEqual([])
  })

  it('consumes a one-shot grant once and rejects changed decision or key binding', async () => {
    const value = grant()
    await grantStore.save(value)
    await expect(store.consume(value.id, { ...claims(value), brokered: { ...value.brokered!, key_id: 'another-key' } })).rejects.toMatchObject({ statusCode: 403 })
    await expect(store.consume(value.id, { ...claims(value), iss: broker })).rejects.toMatchObject({ statusCode: 403 })
    await store.recordToken(value)
    expect((await store.consume(value.id, claims(value))).status).toBe('consumed')
    expect((await database.select().from(schema.brokerAudit)).map(row => row.event)).toEqual(['created', 'token_issued', 'consumed'])
    expect((await store.consume(value.id, claims(value))).error).toBe('already_consumed')
  })

  it('allows exactly one concurrent consumption across independent SQLite connections', async () => {
    const value = grant()
    await grantStore.save(value)
    const otherClient = createClient({ url: `file:${join(directory, 'idp.sqlite')}` })
    const original = database
    database = drizzle(otherClient, { schema })
    const otherStore = createDrizzleBrokerStore()
    database = original
    try {
      const results = await Promise.allSettled([store.consume(value.id, claims(value)), otherStore.consume(value.id, claims(value))])
      expect(results.filter(result => result.status === 'fulfilled' && result.value.status === 'consumed')).toHaveLength(1)
      expect((await grantStore.findById(value.id))?.status).toBe('used')
      expect((await database.select().from(schema.brokerAudit)).filter(row => row.event === 'consumed')).toHaveLength(1)
    }
    finally { otherClient.close() }
  })

  it('bounds the owner inbox across connections and audits decisions atomically', async () => {
    const values = Array.from({ length: 100 }, () => ({ ...grant(), status: 'pending' as const }))
    for (const value of values) await grantStore.save(value)
    await expect(grantStore.save({ ...grant(), status: 'pending' })).rejects.toMatchObject({ statusCode: 429 })
    await grantStore.updateStatus(values[0]!.id, 'denied', { decided_by: owner, decided_at: 2 })
    await grantStore.save({ ...grant(), status: 'pending' })
    const audit = await database.select().from(schema.brokerAudit).where(eq(schema.brokerAudit.grantId, values[0]!.id))
    expect(audit.map(row => row.event)).toEqual(['created', 'denied'])
    expect(audit[1]).toMatchObject({ owner, agent: subject, brokerIssuer: broker, connectionId: connection.id })
  })

  it('makes revocation effective for existing reusable tokens and never resurrects an old connection', async () => {
    const value = grant('always')
    await grantStore.save(value)
    expect((await store.consume(value.id, claims(value))).status).toBe('valid')
    await store.revokeConnection(connection.id, owner)
    await expect(store.consume(value.id, claims(value))).rejects.toMatchObject({ statusCode: 403 })
    await expect(store.acceptRequest(request())).rejects.toMatchObject({ statusCode: 403 })
    const renewed = await store.createConnection({ ...connection, id: randomUUID() })
    expect(renewed.id).not.toBe(connection.id)
    await expect(store.consume(value.id, claims(value))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('keeps external ownership separate from local user permissions and makes enrollment immutable', async () => {
    const binding = { subject, key_id: 'key-one', owner, decision_issuer: issuer, connection_id: connection.id }
    await store.bindAgent(binding, 'Fixture', 'fixture-public-key')
    expect(await database.select().from(schema.users).where(eq(schema.users.email, subject)).get()).toMatchObject({ type: 'agent', owner: null, approver: null })
    await store.bindAgent(binding, 'Fixture', 'fixture-public-key')
    await expect(store.bindAgent({ ...binding, owner: 'another@identity.test' }, 'Fixture', 'fixture-public-key')).rejects.toMatchObject({ statusCode: 403 })
    await database.update(schema.users).set({ isActive: false }).where(eq(schema.users.email, subject))
    await expect(store.bindAgent(binding, 'Fixture', 'fixture-public-key')).rejects.toMatchObject({ statusCode: 403 })
  })
})
