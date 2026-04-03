import { describe, expect, it } from 'vitest'
import {
  InMemoryGrantChallengeStore,
  InMemorySshKeyStore,
  InMemoryUserStore,
} from '../idp/stores.js'
import type { SshKey, User } from '../idp/stores.js'

function makeUser(overrides: Partial<User> = {}): User {
  return {
    email: 'alice@example.com',
    name: 'Alice',
    isActive: true,
    createdAt: Date.now(),
    ...overrides,
  }
}

function makeKey(overrides: Partial<SshKey> = {}): SshKey {
  return {
    keyId: 'key-1',
    userEmail: 'alice@example.com',
    publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG...',
    name: 'My Laptop',
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('inMemoryUserStore', () => {
  it('creates and finds a user by email', async () => {
    const store = new InMemoryUserStore()
    const user = makeUser()
    await store.create(user)
    const found = await store.findByEmail('alice@example.com')
    expect(found).toEqual(user)
  })

  it('returns null for unknown email', async () => {
    const store = new InMemoryUserStore()
    expect(await store.findByEmail('unknown@example.com')).toBeNull()
  })

  it('lists users sorted by createdAt descending', async () => {
    const store = new InMemoryUserStore()
    await store.create(makeUser({ email: 'old@example.com', createdAt: 1000 }))
    await store.create(makeUser({ email: 'new@example.com', createdAt: 2000 }))
    const list = await store.list()
    expect(list).toHaveLength(2)
    expect(list[0].email).toBe('new@example.com')
    expect(list[1].email).toBe('old@example.com')
  })

  it('updates a user', async () => {
    const store = new InMemoryUserStore()
    await store.create(makeUser())
    const updated = await store.update('alice@example.com', { name: 'Alice Updated', isActive: false })
    expect(updated.name).toBe('Alice Updated')
    expect(updated.isActive).toBe(false)
    expect(updated.email).toBe('alice@example.com')
  })

  it('throws on update of non-existent user', async () => {
    const store = new InMemoryUserStore()
    await expect(store.update('missing@example.com', { name: 'X' }))
      .rejects
      .toThrow('User not found: missing@example.com')
  })

  it('deletes a user', async () => {
    const store = new InMemoryUserStore()
    await store.create(makeUser())
    await store.delete('alice@example.com')
    expect(await store.findByEmail('alice@example.com')).toBeNull()
  })

  it('finds users by owner', async () => {
    const store = new InMemoryUserStore()
    await store.create(makeUser({ email: 'agent1@example.com', owner: 'alice@example.com' }))
    await store.create(makeUser({ email: 'agent2@example.com', owner: 'alice@example.com' }))
    await store.create(makeUser({ email: 'other@example.com', owner: 'bob@example.com' }))
    const owned = await store.findByOwner('alice@example.com')
    expect(owned).toHaveLength(2)
    expect(owned.map(u => u.email).sort()).toEqual(['agent1@example.com', 'agent2@example.com'])
  })
})

describe('inMemorySshKeyStore', () => {
  it('saves and finds a key by id', async () => {
    const store = new InMemorySshKeyStore()
    const key = makeKey()
    await store.save(key)
    expect(await store.findById('key-1')).toEqual(key)
  })

  it('returns null for unknown key id', async () => {
    const store = new InMemorySshKeyStore()
    expect(await store.findById('unknown')).toBeNull()
  })

  it('finds keys by user email', async () => {
    const store = new InMemorySshKeyStore()
    await store.save(makeKey({ keyId: 'k1', userEmail: 'alice@example.com' }))
    await store.save(makeKey({ keyId: 'k2', userEmail: 'alice@example.com' }))
    await store.save(makeKey({ keyId: 'k3', userEmail: 'bob@example.com' }))
    const aliceKeys = await store.findByUser('alice@example.com')
    expect(aliceKeys).toHaveLength(2)
  })

  it('finds a key by public key', async () => {
    const store = new InMemorySshKeyStore()
    const key = makeKey({ publicKey: 'ssh-ed25519 UNIQUE_KEY' })
    await store.save(key)
    expect(await store.findByPublicKey('ssh-ed25519 UNIQUE_KEY')).toEqual(key)
  })

  it('returns null for unknown public key', async () => {
    const store = new InMemorySshKeyStore()
    expect(await store.findByPublicKey('nonexistent')).toBeNull()
  })

  it('deletes a key by id', async () => {
    const store = new InMemorySshKeyStore()
    await store.save(makeKey())
    await store.delete('key-1')
    expect(await store.findById('key-1')).toBeNull()
  })

  it('deletes all keys for a user', async () => {
    const store = new InMemorySshKeyStore()
    await store.save(makeKey({ keyId: 'k1', userEmail: 'alice@example.com' }))
    await store.save(makeKey({ keyId: 'k2', userEmail: 'alice@example.com' }))
    await store.save(makeKey({ keyId: 'k3', userEmail: 'bob@example.com' }))
    await store.deleteAllForUser('alice@example.com')
    expect(await store.findByUser('alice@example.com')).toHaveLength(0)
    expect(await store.findByUser('bob@example.com')).toHaveLength(1)
  })
})

describe('inMemoryGrantChallengeStore', () => {
  it('creates and consumes a challenge', async () => {
    const store = new InMemoryGrantChallengeStore()
    const challenge = await store.createChallenge('agent-1')
    expect(challenge).toBeTruthy()
    expect(challenge.length).toBe(64) // 32 bytes hex
    const result = await store.consumeChallenge(challenge, 'agent-1')
    expect(result).toBe(true)
  })

  it('rejects double consumption', async () => {
    const store = new InMemoryGrantChallengeStore()
    const challenge = await store.createChallenge('agent-1')
    await store.consumeChallenge(challenge, 'agent-1')
    expect(await store.consumeChallenge(challenge, 'agent-1')).toBe(false)
  })

  it('rejects wrong entityId', async () => {
    const store = new InMemoryGrantChallengeStore()
    const challenge = await store.createChallenge('agent-1')
    expect(await store.consumeChallenge(challenge, 'agent-2')).toBe(false)
  })

  it('rejects unknown challenge', async () => {
    const store = new InMemoryGrantChallengeStore()
    expect(await store.consumeChallenge('nonexistent', 'agent-1')).toBe(false)
  })

  it('rejects expired challenge', async () => {
    const store = new InMemoryGrantChallengeStore()
    // Access private state to set expiry in the past
    const challenge = await store.createChallenge('agent-1')
    // @ts-expect-error accessing private map for test
    const entry = store.challenges.get(challenge)!
    entry.expiresAt = Date.now() - 1000
    expect(await store.consumeChallenge(challenge, 'agent-1')).toBe(false)
  })
})
