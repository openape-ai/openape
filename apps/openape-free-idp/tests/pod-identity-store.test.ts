import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../server/database/schema'

let directory = ''
let client: ReturnType<typeof createClient>
let database: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../server/database/drizzle', () => ({ useDb: () => database }))
const input = { email: 'pod@example.test', owner: 'owner@example.test', name: 'Pod', keyId: 'key-one', publicKey: 'synthetic-public-key' }
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'pods-idp-'))
  client = createClient({ url: `file:${join(directory, 'identity.sqlite')}` })
  database = drizzle(client, { schema })
  await client.executeMultiple(`
    CREATE TABLE users(email TEXT PRIMARY KEY, id TEXT, name TEXT NOT NULL, owner TEXT, approver TEXT, type TEXT, public_key TEXT, is_active INTEGER NOT NULL, created_at INTEGER NOT NULL, last_login_at INTEGER, recovery_vacation_mode INTEGER NOT NULL DEFAULT 0, recovery_vacation_days INTEGER);
    CREATE TABLE ssh_keys(key_id TEXT PRIMARY KEY, user_email TEXT NOT NULL, public_key TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE grants(id TEXT PRIMARY KEY, requester TEXT NOT NULL, status TEXT NOT NULL);
  `)
  await database.insert(schema.users).values({ email: input.owner, name: 'Owner', type: 'human', isActive: true, createdAt: 1 })
})
afterEach(() => { client.close(); rmSync(directory, { recursive: true, force: true }) })
describe('transactional pod identity', () => {
  it('creates the account and key together with no initial grants and does not revive disabled identities', async () => {
    const { createDrizzlePodIdentityStore } = await import('../server/utils/drizzle-pod-identity-store')
    const store = createDrizzlePodIdentityStore()
    await store.provision(input); await store.provision(input)
    expect(await database.select().from(schema.sshKeys)).toHaveLength(1)
    expect((await client.execute('SELECT * FROM grants')).rows).toHaveLength(0)
    await database.update(schema.users).set({ isActive: false }).where(eq(schema.users.email, input.email))
    await expect(store.provision(input)).rejects.toMatchObject({ statusCode: 409 })
    expect(await database.select().from(schema.users).where(eq(schema.users.email, input.email)).get()).toMatchObject({ isActive: false })
  })
  it('rolls back the account when key insertion fails and rejects substituted owners or keys', async () => {
    const { createDrizzlePodIdentityStore } = await import('../server/utils/drizzle-pod-identity-store')
    const store = createDrizzlePodIdentityStore()
    await store.provision(input)
    await expect(store.provision({ ...input, keyId: 'different' })).rejects.toMatchObject({ statusCode: 409 })
    await client.execute('CREATE TRIGGER fail_key BEFORE INSERT ON ssh_keys WHEN NEW.key_id = \'different\' BEGIN SELECT RAISE(ABORT, \'Synthetic storage failure\'); END')
    await expect(store.provision({ ...input, email: 'another@example.test', keyId: 'different' })).rejects.toThrow()
    expect(await database.select().from(schema.users).where(eq(schema.users.email, 'another@example.test')).get()).toBeUndefined()
    await expect(store.provision({ ...input, owner: 'missing@example.test' })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('refuses existing granted connections instead of wiping permissions', async () => {
    const { createDrizzlePodIdentityStore } = await import('../server/utils/drizzle-pod-identity-store')
    const store = createDrizzlePodIdentityStore(); await store.provision(input)
    await client.execute({ sql: 'INSERT INTO grants VALUES(?,?,?)', args: ['grant-1', input.email, 'approved'] })
    await expect(store.provision(input)).rejects.toMatchObject({ statusCode: 409 })
    expect((await client.execute('SELECT status FROM grants')).rows[0]?.status).toBe('approved')
  })
})
