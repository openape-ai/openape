import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureTables } from '../server/database/migrate'
import * as schema from '../server/database/schema'
import { createDrizzleChallengeStore } from '../server/stores/challenge-store'
import { createDrizzleCodeStore } from '../server/stores/code-store'
import { createDrizzleGrantStore } from '../server/stores/grant-store'
import { createDrizzleJtiStore } from '../server/stores/jti-store'
import { createDrizzleKeyStore } from '../server/stores/key-store'
import { createDrizzleRefreshTokenStore } from '../server/stores/refresh-token-store'
import { createDrizzleSshKeyStore } from '../server/stores/ssh-key-store'
import { createDrizzleUserStore } from '../server/stores/user-store'

// In-memory SQLite for tests
const client = createClient({ url: ':memory:' })
const db = drizzle(client, { schema })

beforeAll(async () => {
  await ensureTables(db)
})

afterAll(() => {
  client.close()
})

// ---------------------------------------------------------------------------
// UserStore
// ---------------------------------------------------------------------------
describe('UserStore', () => {
  const store = createDrizzleUserStore(db)

  it('creates a user without owner/type', async () => {
    const user = await store.create({
      email: 'alice@example.com',
      name: 'Alice',
      isActive: true,
      createdAt: 1000,
    })
    expect(user.email).toBe('alice@example.com')
    expect(user.name).toBe('Alice')
    expect(user.owner).toBeUndefined()
    expect(user.type).toBeUndefined()
  })

  it('creates a user with owner and type', async () => {
    const user = await store.create({
      email: 'bot@example.com',
      name: 'Bot',
      owner: 'alice@example.com',
      type: 'agent',
      isActive: true,
      createdAt: 2000,
    })
    expect(user.owner).toBe('alice@example.com')
    expect(user.type).toBe('agent')
  })

  it('findByEmail returns the user', async () => {
    const user = await store.findByEmail('alice@example.com')
    expect(user).not.toBeNull()
    expect(user!.name).toBe('Alice')
  })

  it('findByEmail returns null for unknown', async () => {
    const user = await store.findByEmail('unknown@example.com')
    expect(user).toBeNull()
  })

  it('list returns users sorted by createdAt desc', async () => {
    const result = await store.list()
    expect(result.data.length).toBeGreaterThanOrEqual(2)
    expect(result.data[0].createdAt).toBeGreaterThanOrEqual(result.data[1].createdAt)
    expect(result.pagination).toBeDefined()
    expect(typeof result.pagination.has_more).toBe('boolean')
  })

  it('update changes user fields', async () => {
    const updated = await store.update('alice@example.com', { name: 'Alice Updated' })
    expect(updated.name).toBe('Alice Updated')
  })

  it('findByOwner returns owned users', async () => {
    const owned = await store.findByOwner('alice@example.com')
    expect(owned.length).toBe(1)
    expect(owned[0].email).toBe('bot@example.com')
  })

  it('delete removes a user', async () => {
    await store.create({
      email: 'temp@example.com',
      name: 'Temp',
      isActive: true,
      createdAt: 500,
    })
    await store.delete('temp@example.com')
    const user = await store.findByEmail('temp@example.com')
    expect(user).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// SshKeyStore
// ---------------------------------------------------------------------------
describe('SshKeyStore', () => {
  const store = createDrizzleSshKeyStore(db)

  const key1 = {
    keyId: 'key-1',
    userEmail: 'alice@example.com',
    publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest1',
    name: 'Alice Laptop',
    createdAt: 1000,
  }

  const key2 = {
    keyId: 'key-2',
    userEmail: 'alice@example.com',
    publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest2',
    name: 'Alice Phone',
    createdAt: 2000,
  }

  it('save + findById', async () => {
    await store.save(key1)
    const found = await store.findById('key-1')
    expect(found).not.toBeNull()
    expect(found!.name).toBe('Alice Laptop')
  })

  it('findByUser returns all keys for email', async () => {
    await store.save(key2)
    const keys = await store.findByUser('alice@example.com')
    expect(keys.length).toBe(2)
  })

  it('findByPublicKey returns the matching key', async () => {
    const found = await store.findByPublicKey(key1.publicKey)
    expect(found).not.toBeNull()
    expect(found!.keyId).toBe('key-1')
  })

  it('findByPublicKey returns null for unknown', async () => {
    const found = await store.findByPublicKey('ssh-ed25519 unknown')
    expect(found).toBeNull()
  })

  it('delete removes a single key', async () => {
    await store.delete('key-1')
    const found = await store.findById('key-1')
    expect(found).toBeNull()
    // key-2 still exists
    const other = await store.findById('key-2')
    expect(other).not.toBeNull()
  })

  it('deleteAllForUser removes all keys for email', async () => {
    await store.save({ ...key1, keyId: 'key-3' })
    await store.deleteAllForUser('alice@example.com')
    const keys = await store.findByUser('alice@example.com')
    expect(keys.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ChallengeStore
// ---------------------------------------------------------------------------
describe('ChallengeStore', () => {
  const store = createDrizzleChallengeStore(db)

  it('createChallenge + consumeChallenge succeeds', async () => {
    const challenge = await store.createChallenge('agent@example.com')
    expect(typeof challenge).toBe('string')
    expect(challenge.length).toBe(64) // 32 bytes hex

    const ok = await store.consumeChallenge(challenge, 'agent@example.com')
    expect(ok).toBe(true)
  })

  it('double consume fails', async () => {
    const challenge = await store.createChallenge('agent@example.com')
    await store.consumeChallenge(challenge, 'agent@example.com')
    const second = await store.consumeChallenge(challenge, 'agent@example.com')
    expect(second).toBe(false)
  })

  it('consume with wrong entityId fails', async () => {
    const challenge = await store.createChallenge('agent@example.com')
    const ok = await store.consumeChallenge(challenge, 'wrong@example.com')
    expect(ok).toBe(false)
  })

  it('consume of unknown challenge fails', async () => {
    const ok = await store.consumeChallenge('nonexistent', 'agent@example.com')
    expect(ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// GrantStore
// ---------------------------------------------------------------------------
describe('GrantStore', () => {
  const store = createDrizzleGrantStore(db)

  const grant1 = {
    id: 'grant-1',
    type: 'command' as const,
    request: {
      requester: 'agent@example.com',
      target_host: 'service.example.com',
      audience: 'apes',
      grant_type: 'once' as const,
      permissions: ['read'],
    },
    status: 'pending' as const,
    created_at: 3000,
  }

  const grant2 = {
    id: 'grant-2',
    type: 'delegation' as const,
    request: {
      requester: 'alice@example.com',
      target_host: 'service.example.com',
      audience: 'apes',
      grant_type: 'once' as const,
      delegator: 'alice@example.com',
      delegate: 'bot@example.com',
    },
    status: 'pending' as const,
    created_at: 4000,
  }

  it('save + findById', async () => {
    await store.save(grant1)
    const found = await store.findById('grant-1')
    expect(found).not.toBeNull()
    expect(found!.request.requester).toBe('agent@example.com')
    expect(found!.status).toBe('pending')
  })

  it('findById returns null for unknown', async () => {
    const found = await store.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('updateStatus changes status and extra fields', async () => {
    await store.updateStatus('grant-1', 'approved', {
      decided_by: 'admin@example.com',
      decided_at: 5000,
      expires_at: 99000,
    })
    const found = await store.findById('grant-1')
    expect(found!.status).toBe('approved')
    expect(found!.decided_by).toBe('admin@example.com')
    expect(found!.decided_at).toBe(5000)
    expect(found!.expires_at).toBe(99000)
  })

  it('findPending returns only pending grants', async () => {
    await store.save(grant2)
    const pending = await store.findPending()
    expect(pending.length).toBe(1)
    expect(pending[0].id).toBe('grant-2')
  })

  it('findByRequester returns matching grants', async () => {
    const results = await store.findByRequester('agent@example.com')
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('grant-1')
  })

  it('findByDelegator returns delegation grants by delegator', async () => {
    const results = await store.findByDelegator!('alice@example.com')
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('grant-2')
  })

  it('findByDelegate returns delegation grants by delegate', async () => {
    const results = await store.findByDelegate!('bot@example.com')
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('grant-2')
  })

  it('listGrants returns paginated results', async () => {
    const result = await store.listGrants({ limit: 1 })
    expect(result.data.length).toBe(1)
    expect(result.pagination.has_more).toBe(true)
    expect(result.pagination.cursor).not.toBeNull()

    // Second page
    const page2 = await store.listGrants({ limit: 1, cursor: result.pagination.cursor! })
    expect(page2.data.length).toBe(1)
    expect(page2.pagination.has_more).toBe(false)
  })

  it('listGrants filters by status', async () => {
    const result = await store.listGrants({ status: 'pending' })
    for (const g of result.data) {
      expect(g.status).toBe('pending')
    }
  })

  it('listGrants filters by requester', async () => {
    const result = await store.listGrants({ requester: 'agent@example.com' })
    for (const g of result.data) {
      expect(g.request.requester).toBe('agent@example.com')
    }
  })
})

// ---------------------------------------------------------------------------
// CodeStore
// ---------------------------------------------------------------------------
describe('CodeStore', () => {
  const store = createDrizzleCodeStore(db)

  it('save + find returns the code entry', async () => {
    await store.save({
      code: 'code-abc',
      clientId: 'client-1',
      redirectUri: 'http://localhost/callback',
      codeChallenge: 'challenge123',
      userId: 'alice@example.com',
      nonce: 'nonce-1',
      expiresAt: Date.now() + 60_000,
    })
    const entry = await store.find('code-abc')
    expect(entry).not.toBeNull()
    expect(entry!.clientId).toBe('client-1')
    expect(entry!.userId).toBe('alice@example.com')
    expect(entry!.nonce).toBe('nonce-1')
  })

  it('find returns null for unknown code', async () => {
    const entry = await store.find('nonexistent')
    expect(entry).toBeNull()
  })

  it('find returns null for expired code', async () => {
    await store.save({
      code: 'code-expired',
      clientId: 'client-1',
      redirectUri: 'http://localhost/callback',
      codeChallenge: 'challenge123',
      userId: 'alice@example.com',
      expiresAt: Date.now() - 1000, // already expired
    })
    const entry = await store.find('code-expired')
    expect(entry).toBeNull()
  })

  it('delete removes the code (single use)', async () => {
    await store.save({
      code: 'code-delete-me',
      clientId: 'client-1',
      redirectUri: 'http://localhost/callback',
      codeChallenge: 'challenge123',
      userId: 'alice@example.com',
      expiresAt: Date.now() + 60_000,
    })
    await store.delete('code-delete-me')
    const entry = await store.find('code-delete-me')
    expect(entry).toBeNull()
  })

  it('saves and retrieves extra data (act, scope, etc.)', async () => {
    await store.save({
      code: 'code-extra',
      clientId: 'client-1',
      redirectUri: 'http://localhost/callback',
      codeChallenge: 'challenge123',
      userId: 'alice@example.com',
      expiresAt: Date.now() + 60_000,
      act: 'human',
      scope: 'openid profile',
    })
    const entry = await store.find('code-extra')
    expect(entry).not.toBeNull()
    expect(entry!.act).toBe('human')
    expect(entry!.scope).toBe('openid profile')
  })
})

// ---------------------------------------------------------------------------
// KeyStore
// ---------------------------------------------------------------------------
describe('KeyStore', () => {
  const store = createDrizzleKeyStore(db)

  it('getSigningKey creates a key on first call', async () => {
    const key = await store.getSigningKey()
    expect(key).toBeDefined()
    expect(key.kid).toMatch(/^key-/)
    expect(key.privateKey).toBeDefined()
    expect(key.publicKey).toBeDefined()
  })

  it('getSigningKey returns the same key on second call', async () => {
    const key1 = await store.getSigningKey()
    const key2 = await store.getSigningKey()
    expect(key1.kid).toBe(key2.kid)
  })

  it('getAllPublicKeys returns at least one key', async () => {
    const keys = await store.getAllPublicKeys()
    expect(keys.length).toBeGreaterThanOrEqual(1)
    expect(keys[0].publicKey).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// JtiStore
// ---------------------------------------------------------------------------
describe('JtiStore', () => {
  const store = createDrizzleJtiStore(db)

  it('markUsed + hasBeenUsed returns true', async () => {
    await store.markUsed('jti-1', 60_000)
    const used = await store.hasBeenUsed('jti-1')
    expect(used).toBe(true)
  })

  it('hasBeenUsed returns false for unknown jti', async () => {
    const used = await store.hasBeenUsed('jti-unknown')
    expect(used).toBe(false)
  })

  it('hasBeenUsed returns false for expired jti', async () => {
    await store.markUsed('jti-expired', 1) // 1ms TTL
    // Wait just a tiny bit to ensure it expires
    await new Promise(resolve => setTimeout(resolve, 10))
    const used = await store.hasBeenUsed('jti-expired')
    expect(used).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// RefreshTokenStore
// ---------------------------------------------------------------------------
describe('RefreshTokenStore', () => {
  const store = createDrizzleRefreshTokenStore(db)

  it('create returns a token and familyId', async () => {
    const result = await store.create('alice@example.com', 'client-1')
    expect(result.token).toBeDefined()
    expect(result.familyId).toBeDefined()
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(0)
  })

  it('consume returns new token and user info', async () => {
    const { token, familyId } = await store.create('alice@example.com', 'client-1')
    const result = await store.consume(token)
    expect(result.newToken).toBeDefined()
    expect(result.newToken).not.toBe(token)
    expect(result.userId).toBe('alice@example.com')
    expect(result.clientId).toBe('client-1')
    expect(result.familyId).toBe(familyId)
  })

  it('token rotation: old token fails after consume', async () => {
    const { token } = await store.create('alice@example.com', 'client-1')
    await store.consume(token)
    // Reusing the old token should throw (reuse detection)
    await expect(store.consume(token)).rejects.toThrow()
  })

  it('revokeFamily prevents further consumption', async () => {
    const { token, familyId } = await store.create('alice@example.com', 'client-1')
    await store.revokeFamily(familyId)
    await expect(store.consume(token)).rejects.toThrow('Token family revoked')
  })

  it('revokeByToken revokes the family', async () => {
    const { token } = await store.create('alice@example.com', 'client-1')
    await store.revokeByToken(token)
    await expect(store.consume(token)).rejects.toThrow()
  })

  it('revokeByUser revokes all families for user', async () => {
    const { token: t1 } = await store.create('revoke-user@example.com', 'client-1')
    const { token: t2 } = await store.create('revoke-user@example.com', 'client-2')
    await store.revokeByUser('revoke-user@example.com')
    await expect(store.consume(t1)).rejects.toThrow()
    await expect(store.consume(t2)).rejects.toThrow()
  })

  it('listFamilies returns active families', async () => {
    const { familyId } = await store.create('list-test@example.com', 'client-1')
    const result = await store.listFamilies({ userId: 'list-test@example.com' })
    expect(result.data.length).toBeGreaterThanOrEqual(1)
    expect(result.data.some(f => f.familyId === familyId)).toBe(true)
    expect(result.pagination).toBeDefined()
  })

  it('listFamilies excludes revoked families', async () => {
    const { familyId } = await store.create('list-revoked@example.com', 'client-1')
    await store.revokeFamily(familyId)
    const result = await store.listFamilies({ userId: 'list-revoked@example.com' })
    expect(result.data.every(f => f.familyId !== familyId)).toBe(true)
  })

  it('consume of invalid token throws', async () => {
    await expect(store.consume('totally-invalid-token')).rejects.toThrow('Invalid refresh token')
  })
})
